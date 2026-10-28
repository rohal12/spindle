/** HTML raw-text bodies preserve character references as written. */
export const RAW_TEXT_ELEMENTS = new Set([
  'script',
  'style',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
]);

/** Text-only bodies recognize their own end tag, never nested HTML tags. */
export const HTML_TEXT_ELEMENTS = new Set([
  ...RAW_TEXT_ELEMENTS,
  'textarea',
  'title',
]);
