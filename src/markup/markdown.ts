import { micromark } from 'micromark';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import {
  gfmStrikethrough,
  gfmStrikethroughHtml,
} from 'micromark-extension-gfm-strikethrough';

/**
 * Parse a text string as CommonMark markdown and return an HTML string.
 * Includes GFM table and strikethrough extensions.
 *
 * When `inline` is true, block-level constructs (lists, headings, blockquotes,
 * thematic breaks) are disabled.  This is used when rendering content inside
 * inline HTML elements like `<span>` where block-level output is invalid.
 */
export function markdownToHtml(
  text: string,
  options?: { inline?: boolean },
): string {
  const disabled: string[] = ['codeIndented'];
  if (options?.inline) {
    disabled.push(
      'list',
      'headingAtx',
      'setextUnderline',
      'thematicBreak',
      'blockQuote',
    );
  }
  return micromark(text, {
    allowDangerousHtml: true,
    extensions: [
      gfmTable(),
      gfmStrikethrough(),
      { disable: { null: disabled } },
    ],
    htmlExtensions: [gfmTableHtml(), gfmStrikethroughHtml()],
  });
}
