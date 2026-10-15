import { glob, readFile, stat } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type * as TweeTs from '@rohal12/twee-ts';
import { errorMessage } from '../utils/error-message';
import { loadOptional, type Importer } from './optional';

/** A story to play: compiled HTML, or a path to HTML, Twee or a project. */
export type StoryInput = { html: string } | { path: string };

export interface ResolvedStory {
  html: string;
  /** Things worth telling the caller; never errors. */
  notes: string[];
}

interface ResolveEnv {
  /** Where twee-ts looks for the Spindle format (its subfolders). */
  formatSearchDir: string;
  /** The installed Spindle version. */
  version: string;
  importer?: Importer;
}

type TweeTsModule = typeof TweeTs;

/**
 * twee-ts takes a format ID to be the name of the folder holding format.js,
 * not the name inside it. The package keeps its format in `dist/pkg/`, and
 * `formatSearchDir` is `dist/`.
 */
const FORMAT_FOLDER = 'pkg';
const HTML_PATH = /\.html?$/i;
const GLOB_CHARS = /[*?[\]{}]/;

/** `file:line: message` per error; just the message without a location. */
function formatDiagnostic(d: {
  message: string;
  file?: string;
  line?: number;
}): string {
  return d.file !== undefined && d.line !== undefined
    ? `${d.file}:${d.line}: ${d.message}`
    : d.message;
}

function diagnosticsError(
  diagnostics: readonly TweeTs.Diagnostic[],
  fallback: string,
): Error {
  const errors = diagnostics.filter((d) => d.level === 'error');
  return new Error(
    errors.length > 0 ? errors.map(formatDiagnostic).join('\n') : fallback,
  );
}

/** The files a glob pattern matches, sorted. */
async function expandGlob(pattern: string): Promise<string[]> {
  const matches: string[] = [];
  for await (const file of glob(pattern)) matches.push(file);
  return matches.sort();
}

/**
 * The project config with its paths made independent of the working
 * directory. twee-ts reads `sources`, `modules` and `headFile` relative to
 * the working directory, and matches `exclude` globs against paths relative
 * to it, so each is rebased from the project directory.
 */
function rebaseConfig(
  dir: string,
  config: TweeTs.TweeTsConfig,
): TweeTs.TweeTsConfig {
  const fromCwd = relative(process.cwd(), dir).split(sep).join('/');
  const rebased: TweeTs.TweeTsConfig = {
    ...config,
    sources: (config.sources ?? ['.']).map((s) => resolve(dir, s)),
  };
  if (config.modules)
    rebased.modules = config.modules.map((m) => resolve(dir, m));
  if (config.headFile !== undefined) {
    rebased.headFile = resolve(dir, config.headFile);
  }
  if (config.exclude && fromCwd !== '') {
    rebased.exclude = config.exclude.map(
      (e) => `${fromCwd}/${e.replace(/^\.\//, '')}`,
    );
  }
  return rebased;
}

/** The compile sources and project config for a path (or glob). */
async function sourcesFor(
  tweeTs: TweeTsModule,
  path: string,
): Promise<{ sources: string[]; config: TweeTs.TweeTsConfig }> {
  let isDirectory = false;
  try {
    isDirectory = (await stat(path)).isDirectory();
  } catch (err) {
    if (!GLOB_CHARS.test(path)) {
      throw new Error(
        `spindle: cannot read story ${path}: ${errorMessage(err)}`,
      );
    }
    // twee-ts does not expand globs.
    const sources = await expandGlob(path);
    if (sources.length === 0) {
      throw new Error(`spindle: no story files match ${path}`);
    }
    return { sources, config: {} };
  }
  if (!isDirectory) return { sources: [path], config: {} };
  const found = tweeTs.loadConfig(path);
  if (!found) return { sources: [path], config: {} };
  const config = rebaseConfig(resolve(path), found);
  if (config.sources?.length === 0) {
    throw new Error(`spindle: ${path} has a twee-ts config with no sources`);
  }
  return { sources: config.sources ?? [], config };
}

/** The diagnostics a thrown twee-ts error carries, when it has any. */
function thrownDiagnostics(err: unknown): TweeTs.Diagnostic[] {
  const diagnostics = (err as { diagnostics?: unknown } | null)?.diagnostics;
  return Array.isArray(diagnostics) ? diagnostics : [];
}

async function compileTwee(path: string, env: ResolveEnv): Promise<string> {
  const tweeTs = await loadOptional<TweeTsModule>(
    '@rohal12/twee-ts',
    'compiling Twee',
    env.importer,
  );
  const { sources, config } = await sourcesFor(tweeTs, path);
  // The format options are ours: the project's own format settings would
  // compile for another format, or fetch one.
  const { output: _output, ...rest } = config;
  let result: TweeTs.CompileResult;
  try {
    result = await tweeTs.compile({
      ...rest,
      sources,
      outputMode: 'html',
      formatPaths: [env.formatSearchDir],
      formatId: FORMAT_FOLDER,
      noRemote: true,
    });
  } catch (err) {
    // A fatal compile error is thrown with its diagnostics.
    const diagnostics = thrownDiagnostics(err);
    throw diagnostics.length > 0
      ? diagnosticsError(diagnostics, errorMessage(err))
      : err;
  }
  if (result.diagnostics.some((d) => d.level === 'error')) {
    throw diagnosticsError(result.diagnostics, 'spindle: Twee did not compile');
  }
  return result.output;
}

/** The `format-version` of the story's `<tw-storydata>`, if it has one. */
function storyFormatVersion(html: string): string | undefined {
  return /<tw-storydata\b[^>]*?\sformat-version="([^"]*)"/.exec(html)?.[1];
}

/** `resolveStoryHtml` with its environment passed in, for tests. */
export async function resolveStoryHtmlWith(
  input: StoryInput,
  env: ResolveEnv,
): Promise<ResolvedStory> {
  let html: string;
  if ('html' in input) {
    html = input.html;
  } else if (HTML_PATH.test(input.path)) {
    try {
      html = await readFile(input.path, 'utf8');
    } catch (err) {
      throw new Error(
        `spindle: cannot read story ${input.path}: ${errorMessage(err)}`,
      );
    }
  } else {
    html = await compileTwee(input.path, env);
  }
  const notes: string[] = [];
  const compiledWith = storyFormatVersion(html);
  if (compiledWith !== undefined && compiledWith !== env.version) {
    notes.push(
      `The story was compiled with Spindle ${compiledWith}; it runs on the installed Spindle ${env.version}.`,
    );
  }
  return { html, notes };
}

/**
 * Turn a story into HTML: inline HTML as given, an `.html` path read, and
 * anything else (a `.twee` file, a glob or a project directory) compiled with
 * the installed Spindle format.
 */
export async function resolveStoryHtml(
  input: StoryInput,
): Promise<ResolvedStory> {
  const { version } = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return resolveStoryHtmlWith(input, {
    formatSearchDir: fileURLToPath(new URL('..', import.meta.url)),
    version,
  });
}
