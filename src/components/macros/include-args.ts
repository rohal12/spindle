import { parseMacroArgs } from './macro-args';

/**
 * The parameters of `{include}`. A standalone `inline` flag only counts
 * outside quotes and brackets, so passage names and expressions containing
 * the word stay intact (#201).
 */
export const INCLUDE_PARAMETERS = [
  { name: 'inline', type: 'flag' },
  { name: 'passage', type: 'passage', required: true },
] as const;

/**
 * The arguments of `{include}`: whether it has the `inline` flag, as its
 * first or last word, and the passage expression that is left.
 */
export function splitIncludeFlag(rawArgs: string): {
  inline: boolean;
  passage: string | undefined;
} {
  const { inline, passage } = parseMacroArgs(rawArgs, INCLUDE_PARAMETERS);
  return { inline, passage };
}
