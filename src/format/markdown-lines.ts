import { parse, postprocess, preprocess } from 'micromark';
import { analyzeMarkup } from '../markup/parse';
import { boundedMarkdownOptions } from '../markup/markdown';
import type { PairedNode } from '../markup/pair';
import { sourceLines } from './source-lines';

/** Source lines belonging to the given constructs in runtime Markdown documents. */
export function markdownLines(
  source: string,
  isBlock: (name: string) => boolean,
  types: ReadonlySet<string>,
): Set<number> {
  const found = new Set<number>();
  // Most passages contain no fence; avoid parsing their Markdown again.
  if (types.size === 1 && types.has('codeFenced') && !/`{3}|~{3}/.test(source))
    return found;
  const { nodes } = analyzeMarkup(source, { hooks: { isBlock } });
  const lineAt = sourceLines(source);

  function visit(nodes: PairedNode[]): void {
    let markdown = '';
    const spans: { start: number; end: number; node: PairedNode }[] = [];
    for (const node of nodes) {
      const start = markdown.length;
      // The renderer substitutes non-text nodes before reading Markdown.
      // Their bodies are separate documents, including each macro branch.
      markdown +=
        node.token.type === 'text'
          ? node.token.value
          : '<span data-tw=0:0></span>';
      spans.push({ start, end: markdown.length, node });
      if (
        node.body &&
        !(node.token.type === 'macro' && node.token.name.toLowerCase() === 'do')
      ) {
        visit(node.body.children);
        for (const branch of node.body.branches) visit(branch.children);
      }
    }
    const events = postprocess(
      parse(boundedMarkdownOptions(markdown))
        .document()
        .write(preprocess()(markdown, undefined, true)),
    );
    for (const [event, token] of events) {
      if (event !== 'enter' || !types.has(token.type)) continue;
      // Spans are ordered and disjoint. Locate only those this token overlaps.
      let low = 0;
      let high = spans.length;
      while (low < high) {
        const middle = (low + high) >>> 1;
        if (spans[middle]!.end <= token.start.offset) low = middle + 1;
        else high = middle;
      }
      for (let i = low; i < spans.length; i++) {
        const span = spans[i]!;
        if (span.start >= token.end.offset) break;
        const start = Math.max(token.start.offset, span.start);
        const end = Math.min(token.end.offset, span.end);
        if (start >= end) continue;
        const text = span.node.token.type === 'text';
        const a = text ? span.node.start + start - span.start : span.node.start;
        const b = text ? span.node.start + end - span.start : span.node.end;
        const first = lineAt(a);
        const last = lineAt(Math.max(a, b - 1));
        for (let line = first; line <= last; line++) found.add(line);
      }
    }
  }

  visit(nodes);
  return found;
}
