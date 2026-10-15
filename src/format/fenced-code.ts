import { parse, postprocess, preprocess } from 'micromark';
import { analyzeMarkup } from '../markup/parse';
import { markdownOptions } from '../markup/markdown';
import type { PairedNode } from '../markup/pair';

/** Source lines that belong to a fenced block in a runtime Markdown document. */
export function fencedCodeLines(
  source: string,
  isBlock: (name: string) => boolean,
): Set<number> {
  const found = new Set<number>();
  // Most passages contain no fence; avoid parsing their Markdown again.
  if (!/`{3}|~{3}/.test(source)) return found;
  const { nodes } = analyzeMarkup(source, { hooks: { isBlock } });

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
        !(node.token.type === 'macro' && node.token.name === 'do')
      ) {
        visit(node.body.children);
        for (const branch of node.body.branches) visit(branch.children);
      }
    }
    const events = postprocess(
      parse(markdownOptions())
        .document()
        .write(preprocess()(markdown, undefined, true)),
    );
    for (const [event, token] of events) {
      if (event !== 'enter' || token.type !== 'codeFenced') continue;
      for (const span of spans) {
        const start = Math.max(token.start.offset, span.start);
        const end = Math.min(token.end.offset, span.end);
        if (start >= end) continue;
        const text = span.node.token.type === 'text';
        const a = text ? span.node.start + start - span.start : span.node.start;
        const b = text ? span.node.start + end - span.start : span.node.end;
        const first = source.slice(0, a).split('\n').length - 1;
        const last = source.slice(0, Math.max(a, b - 1)).split('\n').length - 1;
        for (let line = first; line <= last; line++) found.add(line);
      }
    }
  }

  visit(nodes);
  return found;
}
