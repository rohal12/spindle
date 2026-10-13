import {
  SIGIL_SCOPES,
  lexJs,
  passagePieces,
  pieceOffset,
  type HtmlToken,
  type MacroToken,
  type MarkupError,
  type PieceBase,
  type Token,
  type VariableScope,
} from '../tooling';
import { tokenizeMarkupTolerant } from '../markup/parse';
import { builtinMacros } from './builtin-macros';

/** The CodeMirror 5 token names Twine themes (see the design spec's table). */
export type CmStyle =
  | 'keyword'
  | 'variable-2'
  | 'variable-3'
  | 'string'
  | 'number'
  | 'atom'
  | 'operator'
  | 'link'
  | 'attribute'
  | 'tag'
  | 'comment'
  | 'error';

export interface StyledSpan {
  start: number;
  end: number;
  style: CmStyle;
}

const SCOPE_STYLES: Record<VariableScope, CmStyle> = {
  variable: 'variable-2',
  transient: 'variable-2',
  temporary: 'variable-3',
  local: 'variable-3',
};

const ATOMS = new Set(['true', 'false', 'null']);

/** The words, numbers and runs of punctuation of code with literals blanked. */
const CODE_TOKEN_RE =
  /([\p{L}_$][\p{L}\p{N}_$]*)|(\d[\p{L}\p{N}_.]*|\.\d[\p{L}\p{N}_]*)|([^\s\p{L}\p{N}_$]+)/gu;

/**
 * What is painted on each character of the text. A later paint covers an
 * earlier one, so the innermost construct wins when they are painted
 * outside-in; every paint is one span, even beside an equal style.
 */
class Canvas {
  private readonly styles: (CmStyle | undefined)[];
  private readonly ids: number[];
  private nextId = 1;

  constructor(length: number) {
    this.styles = new Array<CmStyle | undefined>(length).fill(undefined);
    this.ids = new Array<number>(length).fill(0);
  }

  /** Paint [start, end) with `style`; without one, leave it unstyled. */
  paint(start: number, end: number, style?: CmStyle): void {
    const id = this.nextId++;
    const last = Math.min(end, this.styles.length);
    for (let i = Math.max(start, 0); i < last; i++) {
      this.styles[i] = style;
      this.ids[i] = id;
    }
  }

  spans(): StyledSpan[] {
    const spans: StyledSpan[] = [];
    let open: StyledSpan | undefined;
    let openId = 0;
    for (let i = 0; i < this.styles.length; i++) {
      const style = this.styles[i];
      if (style === undefined) {
        open = undefined;
        continue;
      }
      if (open && this.ids[i] === openId) {
        open.end = i + 1;
        continue;
      }
      open = { start: i, end: i + 1, style };
      openId = this.ids[i]!;
      spans.push(open);
    }
    return spans;
  }
}

/** The code of a piece: `code` at `offset` (see pieceOffset), read as `goal`. */
interface CodeRange extends PieceBase {
  code: string;
  goal: 'expression' | 'statements';
}

/**
 * Style the code of `range`: variables, literals, numbers, atoms and
 * operators, unstyled where the code is plain JavaScript words.
 */
function paintCode(canvas: Canvas, range: CodeRange): void {
  const { code } = range;
  const at = (i: number) => pieceOffset(range, i);
  canvas.paint(at(0), at(code.length));
  // The code with everything that is not plain code blanked, to read the
  // words and punctuation of what is left
  const plain = new Array<string>(code.length).fill(' ');
  lexJs(
    code,
    {
      code(ch, index) {
        for (let k = 0; k < ch.length; k++) plain[index + k] = ch[k]!;
      },
      literal(text, index) {
        const comment = text.startsWith('/*') || text.startsWith('//');
        canvas.paint(
          at(index),
          at(index + text.length),
          comment ? 'comment' : 'string',
        );
      },
      variable(sigil, _name, index, _nesting, end) {
        canvas.paint(at(index), at(end), SCOPE_STYLES[SIGIL_SCOPES[sigil]]);
      },
    },
    range.goal,
  );
  for (const m of plain.join('').matchAll(CODE_TOKEN_RE)) {
    const style: CmStyle | undefined = m[1]
      ? ATOMS.has(m[1])
        ? 'atom'
        : undefined
      : m[2]
        ? 'number'
        : 'operator';
    if (style) canvas.paint(at(m.index), at(m.index + m[0].length), style);
  }
}

/**
 * Paint a construct written as an opening up to `nameEnd`, what it holds, and
 * a closer (`}`, `>`, `/>`) of `closerLength`: the frame in `style`.
 */
function paintFrame(
  canvas: Canvas,
  token: { start: number; end: number },
  nameEnd: number,
  closerLength: number,
  style: CmStyle,
): void {
  const closer = token.end - closerLength;
  if (nameEnd >= closer) return canvas.paint(token.start, token.end, style);
  canvas.paint(token.start, nameEnd, style);
  canvas.paint(closer, token.end, style);
}

function paintHtml(canvas: Canvas, text: string, token: HtmlToken): void {
  const closerLength = text.slice(token.end - 2, token.end) === '/>' ? 2 : 1;
  paintFrame(canvas, token, token.tagNameEnd, closerLength, 'tag');
  for (const attribute of token.attributeSpans) {
    canvas.paint(attribute.nameStart, attribute.nameEnd, 'attribute');
    if (attribute.valueStart === undefined) continue;
    const quoted = attribute.quote ? 1 : 0;
    canvas.paint(
      attribute.valueStart - quoted,
      attribute.valueEnd! + quoted,
      'string',
    );
  }
}

function paintToken(canvas: Canvas, text: string, token: Token): void {
  switch (token.type) {
    case 'text':
      if (token.comment) canvas.paint(token.start, token.end, 'comment');
      return;
    case 'link':
      canvas.paint(token.start, token.end, 'link');
      break;
    case 'macro':
      paintFrame(canvas, token, token.nameEnd, 1, 'keyword');
      break;
    case 'variable':
      canvas.paint(
        token.nameStart - 1,
        token.nameEnd,
        SCOPE_STYLES[token.scope],
      );
      break;
    case 'html':
      return paintHtml(canvas, text, token);
    case 'expression':
      break;
  }
  if (token.selectorsStart !== undefined) {
    canvas.paint(token.selectorsStart, token.selectorsEnd!, 'attribute');
  }
}

/** The string literals among a macro's arguments, which are not all code. */
function paintArgumentStrings(canvas: Canvas, token: MacroToken): void {
  lexJs(token.rawArgs, {
    literal(text, index) {
      if (!/^["'`]/.test(text)) return;
      canvas.paint(
        token.argsStart + index,
        token.argsStart + index + text.length,
        'string',
      );
    },
  });
}

/** The `{do}` that no `{/do}` follows, if any: its body is code to the end. */
function openDo(tokens: readonly Token[]): MacroToken | undefined {
  let open: MacroToken | undefined;
  for (const token of tokens) {
    if (token.type !== 'macro' || token.name.toLowerCase() !== 'do') continue;
    open = token.isClose ? undefined : (open ?? token);
  }
  return open;
}

/** Where the `<!--` that no `-->` closes starts, or -1. */
function openComment(tokens: readonly Token[]): number {
  for (const token of tokens) {
    if (token.type !== 'text' || token.comment) continue;
    const at = token.value.indexOf('<!--');
    if (at >= 0) return token.start + at;
  }
  return -1;
}

/** Whether `error` is a construct left open (an unclosed tag, link, …). */
function isUnclosed(error: MarkupError): boolean {
  return error.code.startsWith('unclosed-');
}

/**
 * Where the construct `error` leaves open starts. An unclosed attribute value
 * is reported where the value starts, in a tag that starts before it.
 */
function unclosedStart(text: string, error: MarkupError): number {
  return error.code === 'unclosed-attribute'
    ? Math.max(text.lastIndexOf('<', error.offset), 0)
    : error.offset;
}

/**
 * Non-overlapping spans in source order, offsets into `text`; unstyled text
 * has no span. Half-typed markup is styled as far as it reads, and a
 * construct left open is an `error` (an unclosed `<!--` a `comment`).
 */
export function highlightSpans(text: string): StyledSpan[] {
  try {
    const { tokens, errors } = tokenizeMarkupTolerant(text);
    const canvas = new Canvas(text.length);
    const comment = openComment(tokens);
    if (comment >= 0) canvas.paint(comment, text.length, 'comment');
    for (const error of errors) {
      if (isUnclosed(error)) {
        canvas.paint(unclosedStart(text, error), text.length, 'error');
      } else {
        canvas.paint(
          error.offset,
          Math.max(error.end, error.offset + 1),
          'error',
        );
      }
    }
    for (const token of tokens) {
      if (token.type === 'macro') paintArgumentStrings(canvas, token);
    }
    for (const token of tokens) paintToken(canvas, text, token);
    const body = openDo(tokens);
    for (const piece of passagePieces(text, builtinMacros)) {
      if (piece.kind === 'code') paintCode(canvas, piece);
      if (piece.kind === 'text') {
        for (const token of piece.tokens) paintToken(canvas, text, token);
      }
    }
    if (body) {
      paintCode(canvas, {
        code: text.slice(body.end),
        goal: 'statements',
        offset: body.end,
      });
    }
    return canvas.spans();
  } catch {
    return [];
  }
}

/**
 * Where a construct still open at the end of `text` starts, or -1: an
 * unclosed tag (the tokenizer's `unclosed-*` errors), an unclosed `<!--`, or
 * a `{do}` body without `{/do}`. The earliest wins.
 */
export function openConstructStart(text: string): number {
  try {
    const { tokens, errors } = tokenizeMarkupTolerant(text);
    const starts = [
      ...errors.filter(isUnclosed).map((e) => unclosedStart(text, e)),
      openComment(tokens),
      openDo(tokens)?.start ?? -1,
    ].filter((start) => start >= 0);
    return starts.length > 0 ? Math.min(...starts) : -1;
  } catch {
    return -1;
  }
}
