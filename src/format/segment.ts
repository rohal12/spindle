import { tokenizeMarkupTolerant } from '../markup/parse';
import type { HtmlToken } from '../markup/tokens';
import { sourceLines } from './source-lines';

/** A run of a passage body that is formatted as one kind of content. */
export interface Region {
  type: 'spindle' | 'html' | 'script' | 'svg';
  lines: string[];
}

/**
 * Segment a passage body into regions: spindle (markdown/macros), html blocks, script blocks.
 */
export function segmentRegions(body: string): Region[] {
  const lines = body.split('\n');
  // Remove trailing empty line from split
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) return [];

  // Count only real tags: comments, attributes and macro strings can all
  // contain tag-shaped text. Index once, including the opening region line.
  const tags: HtmlToken[][] = lines.map(() => []);
  const tagEndLines = lines.map((_, line) => line);
  const lineAt = sourceLines(body);
  for (const token of tokenizeMarkupTolerant(body).tokens) {
    if (token.type !== 'html') continue;
    const line = lineAt(token.start);
    tags[line]!.push(token);
    tagEndLines[line] = Math.max(tagEndLines[line]!, lineAt(token.end - 1));
  }
  const depthOnLine = (line: number, name: string) =>
    tags[line]!.reduce(
      (depth, token) =>
        token.tag.toLowerCase() === name && !token.isSelfClose
          ? depth + (token.isClose ? -1 : 1)
          : depth,
      0,
    );

  const regions: Region[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Detect <script> blocks. A same-line element `<script>…</script>` is
    // a region of this line only.
    if (/^<script(\s|>)/i.test(trimmed)) {
      const block = blockLines(lines, i, /<\/script\s*>/i);
      regions.push({ type: 'script', lines: block });
      i += block.length;
      continue;
    }

    // Detect <svg> blocks — treat as opaque to prevent Prettier from
    // breaking multi-line attributes (CommonMark does not list svg as a
    // type-6 HTML block tag, so reformatted multi-line tags break rendering).
    if (/^<svg(\s|>)/i.test(trimmed)) {
      const block = blockLines(lines, i, /<\/svg\s*>/i);
      regions.push({ type: 'svg', lines: block });
      i += block.length;
      continue;
    }

    // Detect multi-line HTML blocks
    if (/^<([a-zA-Z][\w-]*)/.test(trimmed)) {
      const tagMatch = trimmed.match(/^<([a-zA-Z][\w-]*)/);
      const tagName = tagMatch![1]!.toLowerCase();

      // All same-name openers must close, even when an inner one closes on
      // the opening line. Self-closing tags do not increase the depth.
      let depth = depthOnLine(i, tagName);
      // A closed or void tag can still span lines. Never send its attribute
      // continuation through prose indentation or split a closing tag.
      let endLine = tagEndLines[i]!;
      if (depth <= 0 && endLine === i) {
        pushSpindleLine(regions, line);
        i++;
        continue;
      }

      // Multi-line HTML block
      const htmlLines: string[] = [line];
      i++;
      while (i < lines.length && (depth > 0 || i <= endLine)) {
        htmlLines.push(lines[i]!);
        endLine = Math.max(endLine, tagEndLines[i]!);
        depth += depthOnLine(i, tagName);
        i++;
      }
      regions.push({ type: 'html', lines: htmlLines });
      continue;
    }

    // Default: spindle/markdown line
    pushSpindleLine(regions, line);
    i++;
  }

  return regions;
}

/**
 * The lines of the block that opens on line `start`: up to the first line
 * (the opening one included) that matches `close`, or to the end.
 */
function blockLines(lines: string[], start: number, close: RegExp): string[] {
  let end = start;
  while (end < lines.length - 1 && !close.test(lines[end]!)) end++;
  return lines.slice(start, end + 1);
}

/** Append a line to the last spindle region, or create a new one. */
function pushSpindleLine(regions: Region[], line: string): void {
  const last = regions[regions.length - 1];
  if (last?.type === 'spindle') {
    last.lines.push(line);
  } else {
    regions.push({ type: 'spindle', lines: [line] });
  }
}
