import { lexJs, lexTemplate } from '../js-lexer';
import { tokenizeMarkupTolerant } from '../markup/parse';
import type { Token } from '../markup/tokens';

export interface TokenMatch {
  start: number;
  end: number;
  token: string;
  /** Set for a token in the value of an HTML attribute (else absent). */
  inAttribute?: true;
}

/** A `{do}…{/do}` block: its body is JavaScript, run as written. */
export interface DoBlock {
  /** Start of `{do}` and end of `{/do}`. */
  start: number;
  end: number;
  /** The JavaScript between the two tags. */
  bodyStart: number;
  bodyEnd: number;
}

/** What the formatter must leave to the runtime in a piece of markup. */
export interface MarkupScan {
  /** Macros, variables, expressions and links (also those in attribute values), in source order. */
  tokens: TokenMatch[];
  /** The HTML tags (opening, closing and self-closing). */
  tags: { start: number; end: number }[];
  /** The `{do}…{/do}` blocks. */
  doBlocks: DoBlock[];
}

/**
 * Read `text` with Spindle's own tokenizer (`tokenizeMarkupTolerant`), so the
 * formatter protects exactly what the runtime executes. A token inside an
 * HTML attribute value is reported too, with the attribute-safe placeholder
 * it needs, because it must not be reformatted either.
 */
export function scanSpindleMarkup(text: string): MarkupScan {
  const tokens: TokenMatch[] = [];
  const tags: { start: number; end: number }[] = [];
  const doBlocks: DoBlock[] = [];
  let open: Token | undefined;

  const push = (t: { start: number; end: number }, inAttribute?: true) => {
    const match: TokenMatch = {
      start: t.start,
      end: t.end,
      token: text.slice(t.start, t.end),
    };
    if (inAttribute) match.inAttribute = true;
    tokens.push(match);
  };

  for (const t of tokenizeMarkupTolerant(text).tokens) {
    if (t.type === 'html') {
      tags.push({ start: t.start, end: t.end });
      for (const attribute of t.attributeSpans) {
        if (
          attribute.valueStart === undefined ||
          attribute.valueEnd === undefined
        )
          continue;
        const value = text.slice(attribute.valueStart, attribute.valueEnd);
        if (!value.includes('{')) continue;
        for (const inner of tokenizeMarkupTolerant(value, { text: true })
          .tokens) {
          if (
            inner.type === 'macro' ||
            inner.type === 'variable' ||
            inner.type === 'expression'
          ) {
            push(
              {
                start: attribute.valueStart + inner.start,
                end: attribute.valueStart + inner.end,
              },
              true,
            );
          }
        }
      }
    } else if (t.type !== 'text') {
      // The body of {do} is one text token, so nothing in it is a token
      if (t.type === 'macro' && t.name.toLowerCase() === 'do') {
        if (!t.isClose) open = t;
        else if (open) {
          doBlocks.push({
            start: open.start,
            end: t.end,
            bodyStart: open.end,
            bodyEnd: t.start,
          });
          open = undefined;
        }
      }
      push(t);
    }
  }
  return { tokens, tags, doBlocks };
}

/**
 * The ranges of the string and template literals of the JavaScript `code`
 * that span lines (outermost only): their line breaks are part of the value.
 */
export function multilineJsLiterals(code: string): [number, number][] {
  const spans: [number, number][] = [];
  let skipUntil = 0;
  lexJs(
    code,
    {
      literal(text, index, nesting) {
        if (nesting > 0 || index < skipUntil) return;
        const quote = text[0];
        if (quote === '`') {
          // The backtick that opens a template literal: its parts follow
          skipUntil = lexTemplate(code, index);
          if (code.slice(index, skipUntil).includes('\n'))
            spans.push([index, skipUntil]);
        } else if ((quote === '"' || quote === "'") && text.includes('\n')) {
          spans.push([index, index + text.length]);
        }
      },
    },
    'statements',
  );
  return spans;
}

export interface PlaceholderResult {
  text: string;
  tokens: string[];
}

/**
 * Replace `<svg>…</svg>` blocks with HTML comment placeholders so Prettier
 * does not reformat them (CommonMark does not recognise multi-line SVG tags
 * as HTML blocks, so reformatted attributes break rendering).
 */
export function replaceSvgBlocks(html: string): PlaceholderResult {
  const tokens: string[] = [];
  const result = html.replace(/<svg[\s>][\s\S]*?<\/svg>/gi, (match) => {
    const idx = tokens.length;
    tokens.push(match);
    return `<!--SVG:${idx}-->`;
  });
  return { text: result, tokens };
}

/** The placeholders of the token at an index. */
type PlaceholdersOf = (index: number) => string[];

export const SVG_PLACEHOLDERS: PlaceholdersOf = (i) => [`<!--SVG:${i}-->`];
export const SPINDLE_PLACEHOLDERS: PlaceholdersOf = (i) => [
  `<!--SP:${i}-->`,
  `__SP${i}__`,
];

const PLACEHOLDER_PATTERN = /<!--(?:SP|SVG):\d+-->|__SP\d+__/g;

/**
 * Whether `text` (what a formatter made of the placeholdered text) holds
 * the placeholder of every one of `tokens` exactly once. If not, the
 * formatter lost, changed or copied one, and restoring the tokens would
 * lose or duplicate story text.
 */
export function placeholdersIntact(
  text: string,
  tokens: readonly string[],
  placeholdersOf: PlaceholdersOf,
): boolean {
  if (tokens.length === 0) return true;
  const indices = new Map<string, number>();
  const counts = new Array<number>(tokens.length).fill(0);
  tokens.forEach((_, index) => {
    for (const marker of placeholdersOf(index)) indices.set(marker, index);
  });
  for (const [marker] of text.matchAll(PLACEHOLDER_PATTERN)) {
    const index = indices.get(marker);
    if (index !== undefined && ++counts[index]! > 1) return false;
  }
  return counts.every((count) => count === 1);
}

/** Whether `before` and `after` hold the same Spindle tokens, in the same order. */
export function sameSpindleTokens(before: string, after: string): boolean {
  const tokensOf = (text: string) =>
    scanSpindleMarkup(text).tokens.map((m) => m.token);
  const expected = tokensOf(before);
  const found = tokensOf(after);
  return (
    expected.length === found.length && expected.every((t, i) => t === found[i])
  );
}

/**
 * Restore the first occurrence of each marker in the unchanged document.
 * Never search inserted source: literals may spell any other marker.
 */
function restorePlaceholders(
  text: string,
  groups: readonly (readonly [readonly string[], PlaceholdersOf])[],
): string {
  const replacements = new Map<string, string>();
  for (const [tokens, placeholdersOf] of groups) {
    tokens.forEach((token, index) => {
      for (const marker of placeholdersOf(index))
        replacements.set(marker, token);
    });
  }
  return text.replace(PLACEHOLDER_PATTERN, (marker) => {
    const token = replacements.get(marker);
    replacements.delete(marker);
    // Callback form also preserves literal `$&`, `$'`, etc.
    return token ?? marker;
  });
}

/** Restore both families together, so neither can consume the other's source. */
export function restoreHtmlTokens(
  text: string,
  spindle: string[],
  svg: string[],
): string {
  return restorePlaceholders(text, [
    [spindle, SPINDLE_PLACEHOLDERS],
    [svg, SVG_PLACEHOLDERS],
  ]);
}

/**
 * Restore SVG blocks from placeholders.
 */
export function restoreSvgBlocks(text: string, tokens: string[]): string {
  return restorePlaceholders(text, [[tokens, SVG_PLACEHOLDERS]]);
}

/**
 * Replace Spindle tokens with placeholders.
 * Uses <!--SP:N--> in HTML content and __SPN__ in attribute values.
 *
 * Lines that contain Spindle tokens but no HTML tags are replaced as a
 * single whole-line placeholder so Prettier cannot split them. A token that
 * spans lines (a template literal with a line break) keeps its line break:
 * the lines it spans are one line here. A `{do}…{/do}` block is one token:
 * its body is JavaScript executed as written, which an HTML formatter must
 * not re-indent or re-flow.
 */
export function replaceSpindleTokens(html: string): PlaceholderResult {
  const { tokens: found, tags, doBlocks } = scanSpindleMarkup(html);
  // The units to protect, in source order: a do block whole, else each token
  const units: TokenMatch[] = [];
  const pushDoBlock = (block: DoBlock) =>
    units.push({
      start: block.start,
      end: block.end,
      token: html.slice(block.start, block.end),
    });
  let doIndex = 0;
  for (const m of found) {
    for (let block = doBlocks[doIndex]; block && block.end <= m.start;) {
      pushDoBlock(block);
      block = doBlocks[++doIndex];
    }
    const open = doBlocks[doIndex];
    if (open && m.start >= open.start) continue;
    units.push(m);
  }
  for (; doIndex < doBlocks.length; doIndex++) pushDoBlock(doBlocks[doIndex]!);
  units.sort((a, b) => a.start - b.start);

  const tokens: string[] = [];
  const resultLines: string[] = [];
  let unit = 0;
  let tag = 0;
  let lineStart = 0;
  while (lineStart <= html.length) {
    // A line ends at a line break outside every unit
    let lineEnd = lineStart;
    const lineUnits: TokenMatch[] = [];
    for (;;) {
      while (unit < units.length && units[unit]!.end <= lineEnd) unit++;
      const next = units[unit];
      const inside = next && next.start <= lineEnd ? next : undefined;
      if (inside) {
        lineUnits.push(inside);
        lineEnd = inside.end;
        unit++;
        continue;
      }
      if (lineEnd >= html.length || html[lineEnd] === '\n') break;
      lineEnd++;
    }
    const line = html.slice(lineStart, lineEnd);
    const indent = line.match(/^(\s*)/)?.[1] ?? '';
    // Lines and tags are ordered: visit each tag only once, keeping a tag
    // that spans several lines until its end is behind the current line.
    while (tag < tags.length && tags[tag]!.end <= lineStart) tag++;
    const hasTag = tag < tags.length && tags[tag]!.start < lineEnd;

    if (lineUnits.length === 0) {
      resultLines.push(line);
    } else if (!hasTag) {
      // Spindle tokens but no HTML: one placeholder for the whole line
      const idx = tokens.length;
      tokens.push(line.trim());
      resultLines.push(`${indent}<!--SP:${idx}-->`);
    } else {
      // Both HTML and Spindle: one placeholder per token, in source order
      let replaced = '';
      let last = lineStart;
      for (const u of lineUnits) {
        const idx = tokens.length;
        tokens.push(u.token);
        replaced +=
          html.slice(last, u.start) +
          (u.inAttribute ? `__SP${idx}__` : `<!--SP:${idx}-->`);
        last = u.end;
      }
      resultLines.push(replaced + html.slice(last, lineEnd));
    }
    lineStart = lineEnd + 1;
  }

  return { text: resultLines.join('\n'), tokens };
}

/**
 * Restore original Spindle tokens from placeholders.
 */
export function restoreSpindleTokens(text: string, tokens: string[]): string {
  return restorePlaceholders(text, [[tokens, SPINDLE_PLACEHOLDERS]]);
}
