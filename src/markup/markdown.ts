import { micromark } from 'micromark';
import { gfmTable, gfmTableHtml } from 'micromark-extension-gfm-table';
import {
  gfmStrikethrough,
  gfmStrikethroughHtml,
} from 'micromark-extension-gfm-strikethrough';

/**
 * Parse a text string as CommonMark markdown and return an HTML string.
 * Includes GFM table and strikethrough extensions.
 */
export function markdownToHtml(text: string): string {
  return micromark(text, {
    allowDangerousHtml: true,
    extensions: [gfmTable(), gfmStrikethrough()],
    htmlExtensions: [gfmTableHtml(), gfmStrikethroughHtml()],
  });
}
