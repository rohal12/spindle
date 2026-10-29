import {
  SIGIL_SCOPES,
  lexJs,
  pairMarkup,
  passagePiecesOfTokens,
  pieceOffset,
  type HtmlToken,
  type MacroToken,
  type MarkupError,
  type PieceBase,
  type Token,
  type VariableScope,
} from '../tooling';
import { HTML_TEXT_ELEMENTS } from '../markup/html-elements';
import { scanMarkupTolerant, tokenizeMarkupTolerant } from '../markup/parse';

type ScannedMarkup = ReturnType<typeof scanMarkupTolerant>;
import { jsCodeEnd } from '../markup/code-end';
import { builtinMacros } from './builtin-macros';
import { parameterLookup } from '../code-check';

const pairing = parameterLookup(builtinMacros).pairing;

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
  /([\p{L}_$][\p{L}\p{N}_$]*)|((?:\d+\.?\d*|\.\d+)[eE][+-]\d+|(?:\d|\.\d)[\p{L}\p{N}_.]*)|([^\s\p{L}\p{N}_$]+)/gu;

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

/**
 * The text tokens that are markup, each with the HTML text-only element
 * it is in, if any. The text of a `{do}` body is code, and is
 * left out. (Strings and expressions in macros are not text tokens.)
 */
function* markupText(
  tokens: readonly Token[],
): Generator<{ token: Token & { type: 'text' }; element?: string }> {
  let inDo = false;
  let element: string | undefined;
  for (const token of tokens) {
    if (token.type === 'macro' && token.name.toLowerCase() === 'do') {
      inDo = !token.isClose;
    } else if (token.type === 'html') {
      const tag = token.tag.toLowerCase();
      if (token.isClose) {
        if (tag === element) element = undefined;
      } else if (!token.isSelfClose && HTML_TEXT_ELEMENTS.has(tag)) {
        element ??= tag;
      }
    } else if (token.type === 'text' && !token.comment && !inDo) {
      yield { token, element };
    }
  }
}

/**
 * Where the `<!--` that no `-->` closes starts, or -1. In an HTML
 * text-only element, `<!--` is literal text, no HTML comment.
 */
function openComment(tokens: readonly Token[]): number {
  for (const { token, element } of markupText(tokens)) {
    const at = element ? -1 : token.value.indexOf('<!--');
    if (at >= 0) return token.start + at;
  }
  return -1;
}

/** `<name` or `</name`, where a tag may start. */
const TAG_START = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/g;

/**
 * Where a tag starts that is text only for want of its `>`, or -1: `</b`,
 * or `<b_r x=` (no error: `<b` is no tag before `_`), which a `>` on a later
 * line makes a tag. In a text-only element only its end tag counts.
 */
function openTag(text: string, tokens: readonly Token[]): number {
  let closed: number | undefined;
  for (const { token, element } of markupText(tokens)) {
    for (const m of text.slice(token.start, token.end).matchAll(TAG_START)) {
      const at = token.start + m.index;
      if (element && !(m[1] && m[2]!.toLowerCase() === element)) continue;
      // Only a tag ending at the appended > can have been left open.
      // Probe once for all candidates: re-tokenizing every suffix makes
      // plain text such as repeated `</x ` quadratic (#709). The newline
      // also keeps `<a@b` from becoming an email autolink.
      closed ??=
        tokenizeMarkupTolerant(`${text}\n>`).tokens.find(
          (t) => t.type === 'html' && t.end === text.length + 2,
        )?.start ?? -1;
      if (closed === at) return at;
    }
  }
  return -1;
}

/** Whether `error` is a construct left open (an unclosed tag, link, …). */
function isUnclosed(error: MarkupError): boolean {
  return error.code.startsWith('unclosed-');
}

/**
 * Where each construct left open starts: where the tokenizer's damage
 * starts, which for an error inside a tag (an attribute value, code in
 * one) is the tag. An unclosed attribute value is in a tag that starts
 * before it, even where the tag reads as text without it (`<u:9 ="`).
 */
function unclosedStarts(text: string, scan: ScannedMarkup): number[] {
  return scan.errors.flatMap((error, i) => {
    if (!isUnclosed(error)) return [];
    const damage = scan.damage[i]!;
    return error.code === 'unclosed-attribute'
      ? [Math.min(damage, Math.max(text.lastIndexOf('<', error.offset), 0))]
      : [damage];
  });
}

/**
 * The tolerant tokens of `text`, and where code starts whose end may move
 * once text follows (see `jsCodeEnd`).
 */
interface Reading extends ScannedMarkup {
  openEnds: number[];
}

function read(text: string): Reading {
  const ranOut: [input: string, codeStart: number][] = [];
  const scan = scanMarkupTolerant(text, {
    hooks: jsCodeEnd((input, codeStart) => ranOut.push([input, codeStart])),
  });
  // The tokenizer reads the text from its start and from just past each
  // error's damage: to the end, and up to where the damage starts. Code
  // that runs to the end, or into an unclosed construct, may end elsewhere
  // once a line follows; not so code cut off by any other error.
  const bases = [0, ...scan.damage.map((at) => at + 1)];
  const ends = new Set([
    text.length,
    ...scan.damage.filter((_, i) => isUnclosed(scan.errors[i]!)),
  ]);
  const openEnds: number[] = [];
  for (const [input, codeStart] of ranOut) {
    const base = bases.find(
      (at) => ends.has(at + input.length) && text.startsWith(input, at),
    );
    if (base !== undefined) openEnds.push(base + codeStart);
  }
  // The tokenizer reads no code after the last `}`, as none can end there:
  // a `{` after it may start code once a `}` follows
  for (let i = text.indexOf('{', text.lastIndexOf('}') + 1); i >= 0;) {
    openEnds.push(i + 1);
    i = text.indexOf('{', i + 1);
  }
  return { ...scan, openEnds };
}

function spansOf(text: string, reading: Reading): StyledSpan[] {
  const { tokens, errors } = reading;
  const canvas = new Canvas(text.length);
  const comment = openComment(tokens);
  if (comment >= 0) canvas.paint(comment, text.length, 'comment');
  for (const start of unclosedStarts(text, reading)) {
    canvas.paint(start, text.length, 'error');
  }
  for (const error of errors) {
    if (!isUnclosed(error)) {
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
  for (const piece of passagePiecesOfTokens(text, builtinMacros, tokens)) {
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
}

/**
 * Where the construct starts whose code, starting at `at`, may end
 * elsewhere once text follows: the damage of an error the code is in, or
 * the tag holding the code (a raw body starts where its opener ends).
 */
function openCodeStart(scan: ScannedMarkup, at: number): number {
  const i = scan.errors.findIndex(
    (e, i) => scan.damage[i]! < at && at <= Math.max(e.offset, e.end),
  );
  if (i >= 0) return scan.damage[i]!;
  const token = scan.tokens.find(
    (t) => t.type !== 'text' && t.start < at && at <= t.end,
  );
  return token ? token.start : -1;
}

function openStartOf(text: string, reading: Reading): number {
  const { tokens } = reading;
  const starts = [
    ...unclosedStarts(text, reading),
    ...reading.openEnds.map((at) => openCodeStart(reading, at)),
    openComment(tokens),
    openDo(tokens)?.start ?? -1,
    openTag(text, tokens),
  ].filter((start) => start >= 0);
  return starts.length > 0 ? Math.min(...starts) : -1;
}

/**
 * Non-overlapping spans in source order, offsets into `text`; unstyled text
 * has no span. Half-typed markup is styled as far as it reads, and a
 * construct left open is an `error` (an unclosed `<!--` a `comment`).
 */
export function highlightSpans(text: string): StyledSpan[] {
  try {
    return spansOf(text, read(text));
  } catch {
    return [];
  }
}

/**
 * Where a construct still open at the end of `text` starts, or -1: an
 * unclosed tag (the tokenizer's `unclosed-*` errors), an unclosed `<!--`, a
 * `{do}` body without `{/do}`, a tag read as text for want of its `>`
 * (`</b`), or code whose end text after `text` could move: the tokenizer
 * ended it leniently, or found none, because its JavaScript runs to the end
 * (a `//` comment, an open string or template literal). The earliest wins.
 */
export function openConstructStart(text: string): number {
  try {
    return openStartOf(text, read(text));
  } catch {
    return -1;
  }
}

/** `highlightSpans` and `openConstructStart` of `text`, reading it once. */
export function highlightWithOpenStart(text: string): {
  spans: StyledSpan[];
  openStart: number;
  context: string;
} {
  try {
    const reading = read(text);
    const openStart = openStartOf(text, reading);
    // Retain only the enclosing openers before the lexical tail. Branch
    // arguments depend on their parent even when it began on an earlier
    // line; retaining the whole body would make long blocks quadratic (#699).
    const before = openStart < 0 ? text.length : openStart;
    const { errors } = pairMarkup(
      reading.tokens.filter((token) => token.end <= before),
      pairing,
    );
    const openers = errors
      .filter((error) => error.code === 'unclosed-block')
      .sort((a, b) => a.start - b.start)
      .map((error) => text.slice(error.start, error.end));
    return {
      spans: spansOf(text, reading),
      openStart,
      context: openers.length ? openers.join('\n') + '\n' : '',
    };
  } catch {
    return {
      spans: highlightSpans(text),
      openStart: openConstructStart(text),
      context: '',
    };
  }
}
