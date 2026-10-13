export type IconName =
  'links' | 'logic' | 'variables' | 'inputs' | 'ui' | 'check' | 'format';

/** The shapes of each 24x24 icon, drawn as outlines. */
const shapes: Record<IconName, string> = {
  links:
    '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/>' +
    '<path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  logic:
    '<path d="M6 3v12"/><circle cx="18" cy="6" r="3"/>' +
    '<circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
  variables:
    '<path d="M8 4C5 8 5 16 8 20"/><path d="M16 4c3 4 3 12 0 16"/>' +
    '<path d="M9.5 9.5l5 5M14.5 9.5l-5 5"/>',
  inputs:
    '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M8 10v4"/>',
  ui: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
  check: '<path d="M5 13l4 4L19 7"/>',
  format: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
};

/** `color` as the value of an XML attribute written in double quotes. */
function attributeValue(color: string): string {
  return color.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A toolbar icon: an SVG drawn in `color`, as a `data:` URL. */
export function icon(name: IconName, color: string): string {
  const paint = attributeValue(color);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
    `fill="none" stroke="${paint}" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${shapes[name]}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
