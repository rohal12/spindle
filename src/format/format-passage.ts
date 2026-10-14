import { isBlockMacro } from '../markup/ast';
import { tokenizeMarkupTolerant } from '../markup/parse';
import type { MacroToken } from '../markup/tokens';
import { segmentRegions } from './segment';
import {
  formatJS,
  formatCSS,
  formatHTML as formatHTMLPrettier,
  type PrettierLike,
} from './prettier';
import {
  multilineJsLiterals,
  replaceSpindleTokens,
  restoreSpindleTokens,
  replaceSvgBlocks,
  restoreSvgBlocks,
  placeholdersIntact,
  sameSpindleTokens,
  SPINDLE_PLACEHOLDERS,
  SVG_PLACEHOLDERS,
  scanSpindleMarkup,
} from './placeholders';

export type { PrettierLike };

export interface PassageFormatOptions {
  /** The passage's kind (default: 'normal'). A script or stylesheet passage is formatted whole as JavaScript or CSS. */
  kind?: 'normal' | 'script' | 'stylesheet';
  /**
   * Prettier (`prettier` or `prettier/standalone` with the babel, estree,
   * postcss and html plugins), for the code, styles and HTML in the passage.
   * Without it, or where it throws, that text stays as written.
   */
  prettier?: PrettierLike;
  /**
   * The options Prettier is given (default: `{ tabWidth: 2 }`). They replace
   * the default; the formatter sets `parser` (and HTML whitespace handling)
   * itself. Standalone Prettier needs its `plugins` in every call: wrap
   * `prettier` to add them rather than passing them here.
   */
  prettierOptions?: object;
  /** Returns true if the named macro is a block/container macro (default: the built-in block macros and the names the passage closes with `{/name}`). Replaces that default whole; use `blockMacros` to add to it. */
  isBlock?: (name: string) => boolean;
  /** Names of block macros to add to the default `isBlock` (ignored when `isBlock` is given), such as the ones the story or a Twine editor knows. */
  blockMacros?: Iterable<string>;
  /** Returns true for sub-macros that dedent to parent level (default: else, elseif, next, case, default). */
  isDedentingSubMacro?: (name: string) => boolean;
  /** If set, wrap prose lines exceeding this character count. */
  maxLineLength?: number;
}

/** Default dedenting sub-macros. */
const DEFAULT_DEDENTING = new Set([
  'else',
  'elseif',
  'next',
  'case',
  'default',
]);

/** The names of the macros the passage closes with `{/name}`: block macros it defines itself. */
export function closedMacroNames(text: string): Set<string> {
  const found = new Set<string>();
  for (const t of tokenizeMarkupTolerant(text).tokens) {
    if (t.type === 'macro' && t.isClose) found.add(t.name.toLowerCase());
  }
  return found;
}

/** The built-in block macros (and the block widgets the runtime has defined) plus those the passage closes. */
function defaultIsBlock(
  text: string,
  extra: Iterable<string> = [],
): (name: string) => boolean {
  const closed = closedMacroNames(text);
  for (const name of extra) closed.add(name.toLowerCase());
  return (name) => isBlockMacro(name) || closed.has(name.toLowerCase());
}

/**
 * Format the text of one passage.
 *
 * Rules:
 *  1. Indent content inside block macros by 2 spaces per nesting level
 *  2. Dedenting sub-macros (else, elseif, next, case, default) snap to parent indent level
 *  3. Remove trailing whitespace from each line, keeping Markdown hard breaks
 *     (two trailing spaces) and list/code-fence indentation in prose
 *  4. Format `<script>` and HTML blocks, and the whole body of a script or
 *     stylesheet passage, with Prettier (when given)
 *  5. Make the result end with a single newline, in the line-ending style of
 *     the text
 */
export async function formatPassage(
  body: string,
  options: PassageFormatOptions = {},
): Promise<string> {
  // A byte order mark is not story text: format what follows it and keep the mark
  if (body.charCodeAt(0) === 0xfeff) {
    return '\uFEFF' + (await formatPassage(body.slice(1), options));
  }
  // Format with LF endings, then give the output the text's own style
  const eol = dominantEol(body);
  const output = await formatLf(body.replace(/\r\n/g, '\n'), options);
  return eol === '\r\n' ? output.replace(/\n/g, '\r\n') : output;
}

/**
 * The text's line-ending style: whichever of CRLF and LF is more common,
 * the first one found when equally common. (Spindle's compiler normalizes
 * CRLF to LF, so the choice never changes what a story does.)
 */
function dominantEol(text: string): '\n' | '\r\n' {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  if (crlf !== lf) return crlf > lf ? '\r\n' : '\n';
  return text.indexOf('\r\n') !== -1 &&
    text.indexOf('\r\n') < text.indexOf('\n')
    ? '\r\n'
    : '\n';
}

/** `text` with every `from` replaced by `to`, literally. */
function replaceAll(text: string, from: string, to: string): string {
  return text.split(from).join(to);
}

/**
 * Newline stand-in inside multiline Spindle tokens. A private-use character
 * absent from the document: not whitespace, so no line-based step touches it.
 */
function newlineSentinel(text: string): string {
  for (let code = 0xe000; code <= 0xf8ff; code++) {
    const ch = String.fromCharCode(code);
    if (!text.includes(ch)) return ch;
  }
  throw new Error('no free private-use character for the newline stand-in');
}

/**
 * Join each multiline token (macro, interpolation or link, as the Spindle
 * runtime tokenizes it) onto its line with `sentinel` for its newlines. The
 * line-based formatting steps then see one line and cannot re-indent, wrap,
 * trim, segment or re-flow the runtime payload inside it.
 *
 * The body of a `{do}` macro is JavaScript, executed as written: a template
 * literal (or a string continued with a backslash) that spans lines is a
 * value, so its line breaks and the whitespace after them must survive
 * formatting. Those literals are joined too.
 */
function protectMultilineTokens(body: string, sentinel: string): string {
  const { tokens, doBlocks } = scanSpindleMarkup(body);
  const spans: [number, number][] = [];
  for (const m of tokens) {
    if (m.token.includes('\n')) spans.push([m.start, m.end]);
  }
  for (const block of doBlocks) {
    for (const [a, b] of multilineJsLiterals(
      body.slice(block.bodyStart, block.bodyEnd),
    )) {
      spans.push([block.bodyStart + a, block.bodyStart + b]);
    }
  }
  return joinSpans(body, spans, sentinel);
}

/**
 * The JavaScript `code` with the line breaks of its multiline string and
 * template literals replaced by `sentinel`: re-indenting its lines then
 * leaves the literals' values as written.
 */
function joinJsLiterals(code: string, sentinel: string): string {
  return joinSpans(code, multilineJsLiterals(code), sentinel);
}

/** `text` with the line breaks inside each of `spans` replaced by `sentinel`. */
function joinSpans(
  text: string,
  spans: [number, number][],
  sentinel: string,
): string {
  let out = '';
  let last = 0;
  for (const [a, b] of [...spans].sort((x, y) => x[0] - y[0])) {
    out += text.slice(last, a) + replaceAll(text.slice(a, b), '\n', sentinel);
    last = b;
  }
  return out + text.slice(last);
}

async function formatLf(
  text: string,
  options: PassageFormatOptions,
): Promise<string> {
  const { prettier, prettierOptions } = options;
  // Trailing blank lines are not part of the passage's text
  const body = text.replace(/(?:[ \t]*\n)+[ \t]*$/, '\n');

  if (options.kind === 'script' || options.kind === 'stylesheet') {
    const format = options.kind === 'script' ? formatJS : formatCSS;
    const code = body.trim();
    const formatted = await format(code, prettier, prettierOptions);
    return (formatted ?? code).trim().replace(/\n*$/, '\n');
  }

  const isBlock = options.isBlock ?? defaultIsBlock(body, options.blockMacros);
  const isDedenting =
    options.isDedentingSubMacro ??
    ((name: string) => DEFAULT_DEDENTING.has(name.toLowerCase()));
  const sentinel = newlineSentinel(body);
  const lines: string[] = [];
  /** Indices in lines whose trailing two spaces are a hard line break. */
  const hardBreakLines = new Set<number>();

  // Segment into regions. Multiline tokens are joined onto
  // one line first, so their inner lines are never taken for markup.
  const regions = segmentRegions(protectMultilineTokens(body, sentinel));

  for (const region of regions) {
    if (region.type !== 'spindle') {
      // Their text is verbatim, JS or HTML (protected by placeholders): undo the joining
      region.lines = region.lines.map((l) => replaceAll(l, sentinel, '\n'));
    }

    if (region.type === 'script') {
      // Same-line <script>…</script> — leave as written
      if (region.lines.length === 1) {
        lines.push(...region.lines);
        continue;
      }
      // Inline <script> — format JS content between tags
      const innerCode = region.lines.slice(1, -1).join('\n');
      const formatted = await formatJS(
        innerCode.trim(),
        prettier,
        prettierOptions,
      );
      // Without Prettier, where it fails, or where it changed a Spindle
      // token (`{$a}` is an object literal to it), the region stays as written
      if (formatted === undefined || !sameSpindleTokens(innerCode, formatted)) {
        lines.push(...region.lines);
        continue;
      }
      lines.push(region.lines[0]!);
      if (formatted.trim()) {
        // A literal's line breaks are its value: indent only the lines of code
        for (const fLine of joinJsLiterals(formatted.trim(), sentinel).split(
          '\n',
        )) {
          lines.push('  ' + fLine);
        }
      }
      lines.push(region.lines[region.lines.length - 1]!);
      continue;
    }

    if (region.type === 'svg') {
      // SVG block — leave untouched (Prettier would break rendering)
      lines.push(...region.lines);
      continue;
    }

    if (region.type === 'html') {
      const htmlText = region.lines.join('\n');
      // Whitespace that renders as written: the runtime keeps a line break
      // Prettier puts after `<pre>` (a browser's parser drops it), and
      // Prettier cannot see a `white-space` style. Leave such HTML as written.
      if (WHITESPACE_AS_WRITTEN.test(htmlText)) {
        lines.push(...region.lines);
        continue;
      }
      // HTML block — placeholder substitution + Prettier
      const { text: svgPlaceholdered, tokens: svgTokens } =
        replaceSvgBlocks(htmlText);
      const { text: placeholdered, tokens } =
        replaceSpindleTokens(svgPlaceholdered);
      const formatted = await formatHTMLPrettier(
        placeholdered,
        prettier,
        prettierOptions,
      );
      // Without Prettier, where it fails, or where it lost or moved a
      // placeholder (it formats a `<style>` body as CSS, where `<!--SP:0-->`
      // is no comment), the region stays as written
      if (
        formatted === undefined ||
        !placeholdersIntact(formatted, tokens, SPINDLE_PLACEHOLDERS) ||
        !placeholdersIntact(formatted, svgTokens, SVG_PLACEHOLDERS)
      ) {
        lines.push(...region.lines);
        continue;
      }
      // A token's line breaks are its payload: keep them out of the line steps below
      const restoredSpindle = restoreSpindleTokens(
        formatted.trim(),
        tokens.map((t) => replaceAll(t, '\n', sentinel)),
      );
      const restored = restoreSvgBlocks(restoredSpindle, svgTokens);
      for (const fLine of restored.split('\n')) {
        lines.push(fLine);
      }
      continue;
    }

    // Spindle/markdown region — apply macro indentation
    let indented = indentMacros(region.lines, isBlock, isDedenting);
    if (options.maxLineLength) {
      indented = wrapLines(indented, options.maxLineLength);
    }
    for (const line of indented) {
      if (line.endsWith('  ')) hardBreakLines.add(lines.length);
      lines.push(line);
    }
  }
  // Strip trailing whitespace (except Markdown hard breaks, already
  // normalized by indentMacros) and ensure single trailing newline
  let output = lines
    .map((l, i) => (hardBreakLines.has(i) ? l : l.replace(/\s+$/, '')))
    .join('\n');
  output = output.replace(/\n*$/, '\n');

  return replaceAll(output, sentinel, '\n');
}

/** HTML whose whitespace renders as written: a `<pre>` or `<textarea>`, or a `white-space` style. */
const WHITESPACE_AS_WRITTEN = /<(?:pre|textarea)[\s>]|white-space\s*:/i;

/** A Markdown list item line (`- a`, `* a`, `+ a`, `1. a`, `1) a`). */
const LIST_ITEM_REGEX = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;

/** A fenced code block delimiter. */
const CODE_FENCE_REGEX = /^(?:`{3,}|~{3,})/;

/**
 * A block macro body. Spindle renders each body's children as a separate
 * Markdown document, so shifting all of a body's lines by the same amount
 * never changes how it renders.
 */
interface MacroBody {
  /** Index of the line that opened this body; -1 for the region root. */
  openLine: number;
  /** Smallest original indentation column among the body's lines. */
  minCol: number;
  /** True if leading indentation may be Markdown syntax (lists, code fences). */
  keepRelative: boolean;
}

/**
 * Re-indent macro bodies by nesting depth.
 *
 * Each body is re-based so its least-indented line sits 2 spaces inside the
 * line that opened it. When the body contains Markdown whose meaning depends
 * on indentation (list items and their continuations, fenced code), every
 * line keeps its indentation relative to that base (top-level lines keep
 * their original indentation); otherwise all lines snap to the base, since
 * leading whitespace in Spindle's Markdown (indented code blocks are
 * disabled) is insignificant. Closing tags and dedenting sub-macros align
 * with their opening tag.
 *
 * Trailing whitespace is stripped, except that two or more trailing spaces
 * before a non-blank line (a Markdown hard line break) become exactly two.
 */
function indentMacros(
  lines: string[],
  isBlock: (name: string) => boolean,
  isDedenting: (name: string) => boolean,
): string[] {
  const macrosOnLine = macroTokensByLine(lines);
  // Pass 1: assign each line to the body (Markdown document) it belongs to.
  const bodies: MacroBody[] = [
    { openLine: -1, minCol: Infinity, keepRelative: false },
  ];
  const stack: number[] = [0];
  /** Per line: owning body, or the body it closes (`closes`), and its column. */
  const info: ({
    body: number;
    closes?: number;
    col: number;
    text: string;
  } | null)[] = [];

  const openBody = (line: number) => {
    bodies.push({ openLine: line, minCol: Infinity, keepRelative: false });
    stack.push(bodies.length - 1);
  };
  const currentBody = () => stack[stack.length - 1]!;
  const closeBody = (): number | undefined =>
    stack.length > 1 ? stack.pop() : undefined;
  const addLine = (col: number, text: string) => {
    const body = bodies[currentBody()]!;
    body.minCol = Math.min(body.minCol, col);
    if (LIST_ITEM_REGEX.test(text) || CODE_FENCE_REGEX.test(text))
      body.keepRelative = true;
    info.push({ body: currentBody(), col, text });
  };

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i]!;
    const trimmed = lineText.trim();

    if (trimmed === '') {
      info.push(null);
      continue;
    }
    const col = indentColumn(lineText);

    // The macro the line starts with, and the closers that follow it
    const lead = lineText.length - lineText.trimStart().length;
    const macros = macrosOnLine[i]!;
    const [first, ...rest] = macros;
    const startsWithMacro = first !== undefined && first.start === lead;

    // Dedenting sub-macro: closes the previous branch, opens the next one
    if (startsWithMacro && !first.isClose && isDedenting(first.name)) {
      const closed = closeBody();
      if (closed === undefined) addLine(col, trimmed);
      else
        info.push({
          body: currentBody(),
          closes: closed,
          col,
          text: trimmed,
        });
      openBody(i);
      continue;
    }

    // Closing tag
    const closed = startsWithMacro && first.isClose ? closeBody() : undefined;
    if (closed === undefined) addLine(col, trimmed);
    else
      info.push({
        body: currentBody(),
        closes: closed,
        col,
        text: trimmed,
      });

    // Opening container tag
    if (startsWithMacro && !first.isClose && isBlock(first.name)) {
      openBody(i);
    }

    // Closing tags that appear later on the same line (not at the start,
    // which is already handled by the close-at-start check above).
    for (const macro of startsWithMacro ? rest : macros) {
      if (macro.isClose && macro.start > lead) closeBody();
    }
  }

  // Pass 2: compute output indentation.
  const outCol: number[] = [];
  const result: string[] = [];
  for (let i = 0; i < info.length; i++) {
    const line = info[i];
    if (!line) {
      outCol.push(0);
      result.push('');
      continue;
    }
    let col: number;
    if (line.closes !== undefined) {
      col = outCol[bodies[line.closes]!.openLine]!;
    } else {
      // The region root keeps its original indentation when it matters
      const body = bodies[line.body]!;
      const isRoot = body.openLine === -1;
      const base = isRoot ? 0 : outCol[body.openLine]! + 2;
      col =
        base + (body.keepRelative ? line.col - (isRoot ? 0 : body.minCol) : 0);
    }
    outCol.push(col);
    const hardBreak = / {2,}$/.test(lines[i]!) && info[i + 1] ? '  ' : '';
    result.push(' '.repeat(col) + line.text + hardBreak);
  }

  return result;
}

/**
 * The macro tags on each of `lines`, as Spindle tokenizes the lines together
 * (`start` is the offset in the line). A tag spans one line here: the
 * multiline ones were joined onto their line.
 */
function macroTokensByLine(lines: string[]): MacroToken[][] {
  const byLine: MacroToken[][] = lines.map(() => []);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }
  let line = 0;
  for (const token of tokenizeMarkupTolerant(lines.join('\n')).tokens) {
    if (token.type !== 'macro') continue;
    while (line + 1 < lines.length && starts[line + 1]! <= token.start) line++;
    const lineStart = starts[line]!;
    byLine[line]!.push({
      ...token,
      start: token.start - lineStart,
      end: token.end - lineStart,
    });
  }
  return byLine;
}

/** Column of the first non-whitespace character, expanding tabs to 4-column stops. */
function indentColumn(line: string): number {
  let col = 0;
  for (const ch of line) {
    if (ch === ' ') col++;
    else if (ch === '\t') col += 4 - (col % 4);
    else break;
  }
  return col;
}

// ---------------------------------------------------------------------------
// Line wrapping
// ---------------------------------------------------------------------------

/**
 * Wrap lines that exceed maxLen at word boundaries.
 * Preserves leading indentation. Skips pure macro lines and choice/link
 * lines, where wrapping would break syntax.
 */
function wrapLines(lines: string[], maxLen: number): string[] {
  const result: string[] = [];
  const javaScript = doBodyLines(lines);

  for (const [index, line] of lines.entries()) {
    // A `{do}` body is JavaScript: a line break there can change the program
    if (line.length <= maxLen || javaScript.has(index)) {
      result.push(line);
      continue;
    }

    const trimmed = line.trim();

    // Don't wrap empty lines, or lines that are purely structural (macros,
    // links, choices)
    if (
      trimmed === '' ||
      /^\{[\/#.]/.test(trimmed) || // closing/opening-only macro lines
      /^\[\[/.test(trimmed) || // links
      /^\{choice\b/.test(trimmed) || // choice macros
      /^\{choices\b/.test(trimmed)
    ) {
      result.push(line);
      continue;
    }

    // Determine the indentation prefix
    const indentMatch = line.match(/^(\s*)/);
    const indent = indentMatch?.[1] ?? '';

    const wrapped = wordWrap(trimmed, maxLen, indent);
    // Keep a Markdown hard break on the last wrapped line
    if (line.endsWith('  ')) wrapped[wrapped.length - 1] += '  ';
    result.push(...wrapped);
  }

  return result;
}

/** The indices of `lines` that hold part of a `{do}` body. */
function doBodyLines(lines: string[]): Set<number> {
  const found = new Set<number>();
  const text = lines.join('\n');
  for (const block of scanSpindleMarkup(text).doBlocks) {
    const first = text.slice(0, block.bodyStart).split('\n').length - 1;
    const last = text.slice(0, block.bodyEnd).split('\n').length - 1;
    for (let i = first; i <= last; i++) found.add(i);
  }
  return found;
}

/**
 * Wrap a single trimmed line at word boundaries, never inside a macro, an
 * interpolation or a link (as Spindle tokenizes the line).
 * Returns an array of lines with the given indent prefix applied.
 */
function wordWrap(text: string, maxLen: number, indent: string): string[] {
  const lines: string[] = [];
  /** Whether the character is inside a token whose text must stay as written. */
  const inToken = new Array<boolean>(text.length).fill(false);
  for (const token of tokenizeMarkupTolerant(text).tokens) {
    if (token.type === 'text' || token.type === 'html') continue;
    inToken.fill(true, token.start, token.end);
  }
  const room = maxLen - indentColumn(indent);
  // With no room after the prefix, keep the line instead of searching before pos.
  if (room <= 0) return [indent + text];
  let pos = 0;

  while (pos < text.length) {
    if (text.length - pos <= room) {
      lines.push(indent + text.slice(pos));
      break;
    }

    // Find the last space at or before the limit that isn't inside a token
    let breakIdx = -1;
    for (let i = pos + 1; i < text.length && i - pos <= room; i++) {
      if (text[i] === ' ' && !inToken[i]) breakIdx = i;
    }

    // If no break point found before the limit, look for the next space after
    if (breakIdx === -1) {
      for (let i = pos + room + 1; i < text.length; i++) {
        if (text[i] === ' ' && !inToken[i]) {
          breakIdx = i;
          break;
        }
      }
    }

    // No break point at all — emit the whole thing
    if (breakIdx === -1) {
      lines.push(indent + text.slice(pos));
      break;
    }

    lines.push(indent + text.slice(pos, breakIdx));
    pos = breakIdx + 1;
  }

  return lines;
}
