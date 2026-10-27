import { describe, expect, it } from 'vitest';
import {
  parseLock,
  resolvedDependencies,
  snapshot,
  type BunLock,
} from '../../scripts/dependency-snapshot';

describe('parseLock', () => {
  it('drops trailing commas, but not commas in strings', () => {
    expect(
      parseLock('{"a": "x, }", "b": [1, 2,\n],\n "c": "\\", ]",\n}'),
    ).toEqual({ a: 'x, }', b: [1, 2], c: '", ]' });
  });
});

describe('resolvedDependencies', () => {
  const lock: BunLock = {
    workspaces: {
      '': {
        dependencies: { a: '^1.0.0' },
        devDependencies: { d: '^1.0.0', '@s/b': '^2.0.0' },
      },
    },
    packages: {
      a: ['a@1.0.0', '', { dependencies: { c: '^1.0.0' } }, 'sha512-a'],
      c: ['c@1.0.0', '', {}, 'sha512-c'],
      d: [
        'd@1.0.0',
        '',
        { dependencies: { c: '^2.0.0', '@s/b': '^2.0.0' } },
        'sha512-d',
      ],
      'd/c': ['c@2.0.0', '', {}, 'sha512-c2'],
      '@s/b': [
        '@s/b@2.0.0+x',
        '',
        { optionalDependencies: { c: '^3.0.0' } },
        'sha512-b',
      ],
      '@s/b/c': ['c@3.0.0', '', { peerDependencies: { h: '*' } }, 'sha512-c3'],
      // A dependency `h` of `@s/b/c` is `h`, never the scoped `@s/h`
      '@s/h': ['@s/h@1.0.0', '', {}, 'sha512-sh'],
      h: ['h@1.0.0', '', {}, 'sha512-h'],
      git: ['git@github:o/git#abc', {}, 'abc'],
    },
  };
  const resolved = resolvedDependencies(lock);

  it('lists each installed package once by its package URL', () => {
    expect(Object.keys(resolved).sort()).toEqual([
      'pkg:npm/%40s/b@2.0.0%2Bx',
      'pkg:npm/%40s/h@1.0.0',
      'pkg:npm/a@1.0.0',
      'pkg:npm/c@1.0.0',
      'pkg:npm/c@2.0.0',
      'pkg:npm/c@3.0.0',
      'pkg:npm/d@1.0.0',
      'pkg:npm/h@1.0.0',
    ]);
  });

  it('tells direct from indirect and runtime from development', () => {
    const kinds = Object.fromEntries(
      Object.values(resolved).map((r) => [
        r.package_url,
        `${r.relationship} ${r.scope}`,
      ]),
    );
    expect(kinds).toEqual({
      'pkg:npm/a@1.0.0': 'direct runtime',
      'pkg:npm/c@1.0.0': 'indirect runtime',
      'pkg:npm/d@1.0.0': 'direct development',
      'pkg:npm/c@2.0.0': 'indirect development',
      'pkg:npm/%40s/b@2.0.0%2Bx': 'direct development',
      'pkg:npm/c@3.0.0': 'indirect development',
      'pkg:npm/h@1.0.0': 'indirect development',
      'pkg:npm/%40s/h@1.0.0': 'indirect development',
    });
  });

  it('resolves dependencies from the nearest enclosing package', () => {
    expect(resolved['pkg:npm/d@1.0.0']!.dependencies).toEqual([
      'pkg:npm/c@2.0.0',
      'pkg:npm/%40s/b@2.0.0%2Bx',
    ]);
    expect(resolved['pkg:npm/%40s/b@2.0.0%2Bx']!.dependencies).toEqual([
      'pkg:npm/c@3.0.0',
    ]);
    expect(resolved['pkg:npm/c@3.0.0']!.dependencies).toEqual([
      'pkg:npm/h@1.0.0',
    ]);
  });
});

describe('snapshot', () => {
  it('describes the commit and run it was made for', () => {
    const lock: BunLock = {
      workspaces: { '': { dependencies: { a: '1.0.0' } } },
      packages: { a: ['a@1.0.0', '', {}, 'sha512-a'] },
    };
    const env = {
      GITHUB_SHA: 'merge',
      SNAPSHOT_SHA: 'head',
      GITHUB_REF: 'refs/pull/1/merge',
      GITHUB_RUN_ID: '42',
      GITHUB_WORKFLOW: 'Dependencies',
      GITHUB_JOB: 'submit',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'o/r',
    };
    const result = snapshot(lock, env, new Date('2026-01-02T03:04:05Z'));
    expect(result).toMatchObject({
      version: 0,
      sha: 'head',
      ref: 'refs/pull/1/merge',
      job: { correlator: 'Dependencies submit', id: '42' },
      detector: {
        url: 'https://github.com/o/r/blob/main/scripts/dependency-snapshot.ts',
      },
      scanned: '2026-01-02T03:04:05.000Z',
      manifests: {
        'bun.lock': {
          name: 'bun.lock',
          file: { source_location: 'bun.lock' },
          resolved: {
            'pkg:npm/a@1.0.0': { relationship: 'direct', scope: 'runtime' },
          },
        },
      },
    });
  });
});
