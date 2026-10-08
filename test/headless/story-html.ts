/** A story of these passages, as HTML. */
export function storyHtml(passages: Record<string, string>): string {
  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const data = Object.entries(passages)
    .map(
      ([name, content], i) =>
        `<tw-passagedata pid="${i + 1}" name="${escape(name)}" tags="">${escape(content)}</tw-passagedata>`,
    )
    .join('');
  const start = Object.keys(passages).indexOf('Start') + 1 || 1;
  return `<!doctype html><html><body><div id="root"></div><tw-storydata name="Test" startnode="${start}" ifid="TEST-STORY" format="spindle" format-version="0.0.0">${data}</tw-storydata></body></html>`;
}
