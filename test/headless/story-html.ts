/** A story of these passages (Start first), as HTML. */
export function storyHtml(passages: Record<string, string>): string {
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const data = Object.entries(passages)
    .map(
      ([name, content], i) =>
        `<tw-passagedata pid="${i + 1}" name="${escape(name)}" tags="">${escape(content)}</tw-passagedata>`,
    )
    .join('');
  return `<!doctype html><html><body><tw-storydata name="Test" startnode="1" ifid="TEST-STORY" format="spindle" format-version="0.0.0">${data}</tw-storydata></body></html>`;
}
