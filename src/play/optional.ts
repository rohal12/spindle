/**
 * Loading of the optional packages the play entry depends on. `happy-dom` and
 * `@rohal12/twee-ts` are optional peer dependencies: a missing one is reported
 * with the exact command that installs it.
 */

export type OptionalPackage = '@rohal12/twee-ts' | 'happy-dom';

export type Importer = (pkg: string) => Promise<unknown>;

const defaultImporter: Importer = (pkg) => import(pkg);

function isMissingPackage(err: unknown, pkg: string): boolean {
  return (
    err instanceof Error &&
    (err as { code?: unknown }).code === 'ERR_MODULE_NOT_FOUND' &&
    err.message.includes(pkg)
  );
}

/**
 * Import `pkg`, rejecting with an install hint when it isn't installed. Any
 * other import error (a failure inside the package, a different missing
 * module) is rethrown unchanged.
 */
export async function loadOptional<T>(
  pkg: OptionalPackage,
  feature: string,
  importer: Importer = defaultImporter,
): Promise<T> {
  try {
    return (await importer(pkg)) as T;
  } catch (err) {
    if (isMissingPackage(err, pkg)) {
      throw new Error(
        `spindle: ${feature} needs ${pkg}; install it with npm i -D ${pkg}`,
      );
    }
    throw err;
  }
}
