/** A run of a passage body that is formatted as one kind of content. */
export interface Region {
  type: 'spindle' | 'html' | 'script' | 'svg';
  lines: string[];
}

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

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

      // Skip void elements on their own line — not a multi-line block
      if (VOID_ELEMENTS.has(tagName) && !lines[i + 1]?.trim().startsWith('<')) {
        pushSpindleLine(regions, line);
        i++;
        continue;
      }

      // Check if this is truly multi-line: does the tag close on the same line?
      const selfClosing = new RegExp(`</${tagName}\\s*>`, 'i');
      if (selfClosing.test(trimmed)) {
        pushSpindleLine(regions, line);
        i++;
        continue;
      }

      // Multi-line HTML block
      const htmlLines: string[] = [line];
      let depth = 1;
      i++;
      while (i < lines.length && depth > 0) {
        htmlLines.push(lines[i]!);
        const opens = (
          lines[i]!.match(new RegExp(`<${tagName}(?:[\\s>]|$)`, 'gi')) ?? []
        ).length;
        const closes = (
          lines[i]!.match(new RegExp(`</${tagName}\\s*>`, 'gi')) ?? []
        ).length;
        depth += opens - closes;
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
