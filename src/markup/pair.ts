/**
 * Pairing: which closer closes which opener among the flat tokens of markup
 * (parse.ts tokenizeMarkup), and which branch (`{else}`, `{case}`) belongs to
 * which macro. The runtime AST (ast.ts) is built from this, and editor tooling
 * reads the same tree (`pairMarkup` in tooling.ts), so both agree on where a
 * block starts and ends.
 *
 * It never throws: a problem is an entry of `errors`, and the tree is
 * recovered around it. A closer closes the innermost open element, as the
 * runtime reads it, or, when it matches one further out, closes that one and
 * what was open inside it stays unclosed.
 */
import { lineColumn } from './line-column';
import { isBlockMacro, isRawMacro } from './ast';
import type { HtmlToken, MacroToken, Span, Token } from './tokens';

/** What is wrong with the pairing, by kind. */
export type PairingErrorCode =
  | 'unclosed-block'
  | 'mismatched-closer'
  | 'stray-closer'
  | 'misplaced-branch';

/**
 * A problem in the pairing of the tokens, at the token from `start` up to
 * `end` (offsets in the source).
 */
export interface PairingError extends Span {
  code: PairingErrorCode;
  /** What is wrong, without the position. */
  message: string;
  /**
   * The offset a parser reading left to right notices it at: where the
   * closer ends, or past the end of the markup for what is left open there.
   */
  noticedAt: number;
  /** The names involved, by code (see MarkupError.data). */
  data: Record<string, string>;
}

/** A branch (`{else}`, `{case}`, …) of a macro, with what follows it. */
export interface PairedBranch {
  tag: MacroToken;
  children: PairedNode[];
}

/** What a macro or element holds, up to its closer. */
export interface PairedBody {
  children: PairedNode[];
  branches: PairedBranch[];
  /** The closing tag; absent if it is never closed. */
  close?: MacroToken | HtmlToken;
}

/**
 * A node of the tree: a token that stands alone (text, a link, a variable, an
 * expression, a macro without a body, a self-closing element), or the opening
 * tag of a macro or element with its `body`.
 */
export interface PairedNode {
  /** The token, or the opening tag of the element. */
  token: Token;
  body?: PairedBody;
  /** From the start of the token to the end of the closer (or of the body). */
  start: number;
  end: number;
}

export interface PairMarkupOptions {
  /** Whether a macro takes a body (default: the registered block macros). */
  isBlock?(name: string): boolean;
  /**
   * Whether a macro's body is JavaScript, kept verbatim as one text token
   * (default: `{do}`). One that is never closed is a problem at its opening
   * tag, where the body would start, and the markup after it is not its body.
   */
  isRaw?(name: string): boolean;
  /**
   * The markup the tokens are of: lets a message say at which line and column
   * an element was opened (else it says at which offset).
   */
  source?: string;
}

export interface PairedMarkup {
  nodes: PairedNode[];
  errors: PairingError[];
}

/** The last of `items`. */
const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];

/** The macro each branch macro belongs to. */
export const BRANCH_PARENT: Readonly<Record<string, string>> = {
  elseif: 'if',
  else: 'if',
  case: 'switch',
  default: 'switch',
  next: 'timed',
};

const isBranchTag = (token: Token): boolean =>
  token.type === 'macro' &&
  !token.isClose &&
  Object.prototype.hasOwnProperty.call(BRANCH_PARENT, token.name.toLowerCase());

const lowerName = (token: MacroToken | HtmlToken) =>
  nameOf(token).toLowerCase();

/** The macro name or HTML tag of `tag`, as written. */
const nameOf = (tag: MacroToken | HtmlToken): string =>
  tag.type === 'macro' ? tag.name : tag.tag;

/** How a tag reads in an error message. */
export function tagLabel(tag: MacroToken | HtmlToken): string {
  return tag.type === 'html'
    ? `${tag.isClose ? '</' : '<'}${tag.tag}>`
    : `{${tag.isClose ? '/' : ''}${tag.name}}`;
}

/** The tag that closes the element opened by `tag`. */
const closerOf = (tag: MacroToken | HtmlToken): string =>
  tag.type === 'html' ? `</${tag.tag}>` : `{/${tag.name}}`;

/** An element being read: its opening tag, and what it holds so far. */
interface Frame {
  node: PairedNode;
  body: PairedBody;
  /** Where the next child goes: the body, or its last branch. */
  into: PairedNode[];
}

/** How an element ends: with its closer, or without. */
type Ending = 'closed' | 'unclosed' | 'mismatch' | 'cut';

/** Whether `close` is the closing tag of the element opened by `open`. */
const closes = (open: Token, close: MacroToken | HtmlToken): boolean =>
  open.type === close.type &&
  lowerName(open as MacroToken | HtmlToken) === lowerName(close);

/**
 * Pair `tokens`, the tokens of `source`, into a tree: elements with their
 * bodies and branches, and the problems found (unclosed, mismatched and
 * stray closers, branches outside their macro) in the order a parser reading
 * from left to right notices them.
 */
export function pairMarkup(
  tokens: readonly Token[],
  options: PairMarkupOptions = {},
): PairedMarkup {
  const isBlock = options.isBlock ?? isBlockMacro;
  const isRaw = options.isRaw ?? isRawMacro;
  const errors: PairingError[] = [];
  const noticedAtEnd = (tokens[tokens.length - 1]?.end ?? 0) + 1;
  const where = (offset: number) => {
    if (options.source === undefined) return `offset ${offset}`;
    const { line, column } = lineColumn(options.source, offset);
    return `line ${line}, column ${column}`;
  };
  const report = (
    code: PairingErrorCode,
    token: Token,
    message: string,
    noticedAt: number,
    data: Record<string, string>,
  ) => {
    errors.push({
      code,
      message,
      start: token.start,
      end: token.end,
      noticedAt,
      data,
    });
  };

  /** A branch outside its macro, or inside another element `inside`. */
  const misplaced = (
    tag: MacroToken,
    inside: MacroToken | HtmlToken | undefined,
    noticedAt: number,
  ) => {
    const parent = BRANCH_PARENT[tag.name.toLowerCase()]!;
    const where = inside ? `, not inside ${tagLabel(inside)}` : '';
    report(
      'misplaced-branch',
      tag,
      `${tagLabel(tag)} must be directly inside {${parent}}${where}`,
      noticedAt,
      { name: tag.name, parent, ...(inside && { inside: nameOf(inside) }) },
    );
  };

  const root: PairedNode[] = [];
  const stack: Frame[] = [];
  const add = (node: PairedNode) => (last(stack)?.into ?? root).push(node);

  /**
   * End the element on top of the stack, with `close` if it has one: its
   * misplaced branches are reported first, then how it ends.
   */
  const end = (
    ending: Ending,
    close?: MacroToken | HtmlToken,
    owns = ending === 'closed',
  ) => {
    const { node, body } = stack.pop()!;
    const open = node.token as MacroToken | HtmlToken;
    const noticedAt = close ? close.end : noticedAtEnd;
    for (const { tag } of body.branches) {
      const parent = BRANCH_PARENT[tag.name.toLowerCase()]!;
      if (open.type !== 'macro' || lowerName(open) !== parent) {
        misplaced(tag, open, noticedAt);
      }
    }
    if (ending === 'unclosed') {
      report(
        'unclosed-block',
        open,
        `Unclosed ${tagLabel(open)}: no ${closerOf(open)} closes it`,
        noticedAt,
        { name: nameOf(open) },
      );
    } else if (ending === 'mismatch') {
      report(
        'mismatched-closer',
        close!,
        `${tagLabel(close!)} found where ${closerOf(open)} should close the ${tagLabel(open)} opened at ${where(open.start)}`,
        noticedAt,
        { name: nameOf(open), closer: nameOf(close!) },
      );
    }
    if (owns) body.close = close;
    node.end = body.close?.end ?? lastEnd(body) ?? open.end;
    add(node);
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if ((token.type === 'macro' || token.type === 'html') && token.isClose) {
      const top = last(stack);
      if (!top) {
        report(
          'stray-closer',
          token,
          `${tagLabel(token)} closes nothing: no ${token.type === 'html' ? `<${token.tag}>` : `{${token.name}}`} is open here`,
          token.start,
          { name: nameOf(token) },
        );
      } else if (closes(top.node.token, token)) {
        end('closed', token);
      } else {
        // The closer ends the innermost element, as the runtime reads it;
        // when it names one further out, it ends that one, and the elements
        // inside it are left unclosed
        let outer = stack.length - 1;
        while (outer >= 0 && !closes(stack[outer]!.node.token, token)) outer--;
        end('mismatch', token, outer === -1);
        if (outer !== -1) {
          while (stack.length > outer + 1) end('cut', token);
          end('closed', token);
        }
      }
      continue;
    }
    if (isBranchTag(token)) {
      const tag = token as MacroToken;
      const frame = last(stack);
      if (!frame) {
        misplaced(tag, undefined, tag.start);
        continue;
      }
      const branch: PairedBranch = { tag, children: [] };
      frame.body.branches.push(branch);
      frame.into = branch.children;
      continue;
    }
    const node: PairedNode = { token, start: token.start, end: token.end };
    const opens =
      token.type === 'html'
        ? !token.isSelfClose
        : token.type === 'macro' && isBlock(token.name.toLowerCase());
    if (
      opens &&
      token.type === 'macro' &&
      isRaw(token.name.toLowerCase()) &&
      !closesRawBody(token, tokens[i + 1], tokens[i + 2])
    ) {
      // Its body is looked for as soon as the tag is read: the markup after
      // it is not its body
      report(
        'unclosed-block',
        token,
        `Unclosed ${tagLabel(token)}: no ${closerOf(token)} closes it`,
        token.end,
        { name: nameOf(token) },
      );
      add(node);
      continue;
    }
    if (!opens) {
      add(node);
      continue;
    }
    const body: PairedBody = { children: [], branches: [] };
    node.body = body;
    stack.push({ node, body, into: body.children });
  }
  while (stack.length > 0) end('unclosed');
  return { nodes: root, errors };
}

/**
 * Whether the tokens after the opening tag `open` of a raw macro are its
 * body (one text token, if it is not empty) and its closer.
 */
function closesRawBody(
  open: MacroToken,
  next: Token | undefined,
  after: Token | undefined,
): boolean {
  const closer = (t: Token | undefined) =>
    t?.type === 'macro' && t.isClose && closes(open, t);
  return closer(next) || (next?.type === 'text' && closer(after));
}

/** The end of the last thing in `body`. */
function lastEnd(body: PairedBody): number | undefined {
  const branch = last(body.branches);
  return last(branch?.children ?? body.children)?.end ?? branch?.tag.end;
}
