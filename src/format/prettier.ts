/**
 * The Prettier calls of the formatter. Prettier is not imported here: the
 * caller injects it, so this module (and the tooling bundle that has it) holds
 * no copy of Prettier. Without it, or when it throws on a piece of code, there
 * is no formatted text (`undefined`): the caller keeps the code as written.
 */

/** The part of Prettier's API the formatter calls (`prettier` and `prettier/standalone` have it). */
export interface PrettierLike {
  format(code: string, options: object): Promise<string>;
}

/** The options the formatter gives Prettier unless the caller passes its own. */
export const DEFAULT_PRETTIER_OPTIONS = { tabWidth: 2 };

async function run(
  code: string,
  prettier: PrettierLike | undefined,
  options: object | undefined,
  overrides: object,
): Promise<string | undefined> {
  if (!prettier) return undefined;
  try {
    return await prettier.format(code, {
      ...(options ?? DEFAULT_PRETTIER_OPTIONS),
      ...overrides,
    });
  } catch {
    return undefined;
  }
}

export function formatJS(
  code: string,
  prettier?: PrettierLike,
  options?: object,
): Promise<string | undefined> {
  return run(code, prettier, options, { parser: 'babel' });
}

export function formatCSS(
  code: string,
  prettier?: PrettierLike,
  options?: object,
): Promise<string | undefined> {
  return run(code, prettier, options, { parser: 'css' });
}

export function formatHTML(
  code: string,
  prettier?: PrettierLike,
  options?: object,
): Promise<string | undefined> {
  return run(code, prettier, options, {
    parser: 'html',
    htmlWhitespaceSensitivity: 'ignore',
  });
}
