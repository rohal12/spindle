/**
 * The packages bun.lock installs, as a snapshot for GitHub's dependency
 * submission API. GitHub's dependency graph reads package.json but not
 * bun.lock, so without the snapshot the dependencies of dependencies get no
 * Dependabot alerts and dependency review does not see them change.
 *
 *   node scripts/dependency-snapshot.ts | gh api repos/OWNER/REPO/dependency-graph/snapshots --input -
 *
 * The snapshot describes the commit SNAPSHOT_SHA (else GITHUB_SHA) and the
 * workflow run in the GITHUB_* variables Actions sets. It runs with Node and
 * no installed packages, so a workflow can submit without installing them.
 */
import { readFileSync } from 'node:fs';

type Specifiers = Record<string, string>;

/** The parts of bun.lock (the text lockfile) read here. */
export interface BunLock {
  workspaces: Record<
    string,
    {
      dependencies?: Specifiers;
      devDependencies?: Specifiers;
      optionalDependencies?: Specifiers;
    }
  >;
  /**
   * By install path (`vite/postcss` is the `postcss` that `vite` gets): the
   * `name@version` installed there, then details that include its
   * dependencies in an object.
   */
  packages: Record<string, readonly [spec: string, ...details: unknown[]]>;
}

/** A package in a snapshot manifest. */
export interface Resolved {
  package_url: string;
  relationship: 'direct' | 'indirect';
  scope: 'runtime' | 'development';
  dependencies: string[];
}

/** bun.lock is JSON with trailing commas: drop those, outside strings. */
export function parseLock(text: string): BunLock {
  return JSON.parse(
    text.replace(
      /"(?:[^"\\]|\\.)*"|,(\s*[}\]])/g,
      (match, close: string | undefined) => close ?? match,
    ),
  );
}

/**
 * The package URL of `name@version`; undefined when the version is not one
 * from the registry (a git, file or workspace dependency).
 */
function packageUrl(spec: string): string | undefined {
  const at = spec.lastIndexOf('@');
  const version = spec.slice(at + 1);
  if (at <= 0 || !/^[\w.+-]+$/.test(version)) return undefined;
  const name = spec.slice(0, at).replace(/^@/, '%40');
  return `pkg:npm/${name}@${encodeURIComponent(version)}`;
}

/** The package names along an install path: `a/@s/b` is `a`, `@s/b`. */
function namesOf(path: string): string[] {
  const parts = path.split('/');
  const names: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    names.push(
      parts[i]!.startsWith('@') ? `${parts[i]}/${parts[++i]}` : parts[i]!,
    );
  }
  return names;
}

/**
 * The install paths of the dependencies of the package at `path`: each from
 * the nearest enclosing package that has it, as Node resolves `node_modules`.
 */
function dependencyPaths(lock: BunLock, path: string): string[] {
  const [, ...details] = lock.packages[path]!;
  const info = details.find(
    (detail): detail is Record<string, Specifiers | undefined> =>
      typeof detail === 'object' && detail !== null && !Array.isArray(detail),
  );
  const names = Object.keys({
    ...info?.dependencies,
    ...info?.optionalDependencies,
    ...info?.peerDependencies,
  });
  const enclosing = namesOf(path);
  return names.flatMap((name) => {
    for (let depth = enclosing.length; depth >= 0; depth--) {
      const candidate = [...enclosing.slice(0, depth), name].join('/');
      if (candidate in lock.packages) return [candidate];
    }
    return []; // an optional peer that is not installed
  });
}

/**
 * Every package bun.lock installs, by package URL. A package the workspace's
 * `dependencies` reach is `runtime`, any other `development`.
 */
export function resolvedDependencies(lock: BunLock): Record<string, Resolved> {
  const root = lock.workspaces[''] ?? {};
  const runtime = Object.keys({
    ...root.dependencies,
    ...root.optionalDependencies,
  });
  const direct = [...runtime, ...Object.keys(root.devDependencies ?? {})];
  const resolved: Record<string, Resolved> = {};
  const seen = new Set<string>();
  const walk = (from: string[], scope: Resolved['scope']) => {
    // Grows while it is read: the paths each package found leads to
    const paths = [...from];
    for (const path of paths) {
      if (seen.has(path) || !(path in lock.packages)) continue;
      seen.add(path);
      const children = dependencyPaths(lock, path);
      paths.push(...children);
      const url = packageUrl(lock.packages[path]![0]);
      if (!url) continue;
      const entry = (resolved[url] ??= {
        package_url: url,
        relationship: 'indirect',
        scope,
        dependencies: [],
      });
      for (const child of children) {
        const dependency = packageUrl(lock.packages[child]![0]);
        if (dependency && !entry.dependencies.includes(dependency)) {
          entry.dependencies.push(dependency);
        }
      }
    }
  };
  walk(runtime, 'runtime');
  walk(direct, 'development');
  // Installed for no package of the workspace, e.g. a peer of a peer
  walk(Object.keys(lock.packages), 'development');
  for (const name of direct) {
    const url = name in lock.packages && packageUrl(lock.packages[name]![0]);
    if (url && resolved[url]) resolved[url].relationship = 'direct';
  }
  return resolved;
}

/** The snapshot of `lock` to submit from the workflow run `env` describes. */
export function snapshot(
  lock: BunLock,
  env: Record<string, string | undefined>,
  scanned: Date,
) {
  const source = `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/blob/main/scripts/dependency-snapshot.ts`;
  return {
    version: 0,
    sha: env.SNAPSHOT_SHA || env.GITHUB_SHA,
    ref: env.GITHUB_REF,
    job: {
      correlator: `${env.GITHUB_WORKFLOW} ${env.GITHUB_JOB}`,
      id: env.GITHUB_RUN_ID,
    },
    detector: { name: 'spindle bun.lock', version: '1', url: source },
    scanned: scanned.toISOString(),
    manifests: {
      'bun.lock': {
        name: 'bun.lock',
        file: { source_location: 'bun.lock' },
        resolved: resolvedDependencies(lock),
      },
    },
  };
}

if (import.meta.main) {
  const lock = parseLock(readFileSync('bun.lock', 'utf8'));
  process.stdout.write(JSON.stringify(snapshot(lock, process.env, new Date())));
}
