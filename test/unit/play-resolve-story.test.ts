// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadOptional } from '../../src/play/optional';
import { resolveStoryHtmlWith } from '../../src/play/resolve-story';
import { storyHtml } from '../headless/story-html';

const root = resolve(__dirname, '../..');
const env = {
  formatSearchDir: resolve(root, 'dist'),
  version: '1.2.3',
};

const STORY_DATA =
  ':: StoryData\n{"ifid":"D674C58C-DEFA-4F70-B7A2-27742230C0FC","format":"spindle"}\n\n';
const TWEE = `${STORY_DATA}:: Start\n[[Next]]\n\n:: Next\nThe end\n`;

const missing = (pkg: string) => async () => {
  throw Object.assign(new Error(`Cannot find package '${pkg}'`), {
    code: 'ERR_MODULE_NOT_FOUND',
  });
};

let tmp: string;
let tweeFile: string;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'spindle-play-'));
  tweeFile = join(tmp, 'story.twee');
  await writeFile(tweeFile, TWEE);
});
afterAll(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('loadOptional', () => {
  it('returns the imported module', async () => {
    const mod = { ok: true };
    expect(
      await loadOptional('happy-dom', 'play sessions', async () => mod),
    ).toBe(mod);
  });
  it('names the feature and package when the package is missing', async () => {
    await expect(
      loadOptional('happy-dom', 'play sessions', missing('happy-dom')),
    ).rejects.toThrow(
      'spindle: play sessions needs happy-dom; install it with npm i -D happy-dom',
    );
  });
  it('rethrows a missing module that is not the package itself', async () => {
    const error = Object.assign(new Error("Cannot find module './other.js'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });
    await expect(
      loadOptional('happy-dom', 'play sessions', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
  it('rethrows a missing dependency of the package, whose path names it', async () => {
    const error = Object.assign(
      new Error(
        "Cannot find package 'x' imported from /app/node_modules/happy-dom/lib/index.js",
      ),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );
    await expect(
      loadOptional('happy-dom', 'play sessions', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
  it('rethrows any other import error unchanged', async () => {
    const error = new Error("Cannot find package 'happy-dom'");
    await expect(
      loadOptional('happy-dom', 'play sessions', async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });
});

describe('resolveStoryHtmlWith', () => {
  it('returns inline html with no notes when versions match', async () => {
    const html = storyHtml({ Start: 'Hi' }).replace(
      'format-version="0.0.0"',
      'format-version="1.2.3"',
    );
    expect(await resolveStoryHtmlWith({ html }, env)).toEqual({
      html,
      notes: [],
    });
  });

  it('notes a format version mismatch', async () => {
    const { notes } = await resolveStoryHtmlWith(
      { html: storyHtml({ Start: 'Hi' }) },
      env,
    );
    expect(notes).toEqual([
      'The story was compiled with Spindle 0.0.0; it runs on the installed Spindle 1.2.3.',
    ]);
  });

  it('reads an .html path', async () => {
    const html = storyHtml({ Start: 'Hi' });
    const file = join(tmp, 'story.html');
    await writeFile(file, html);
    expect((await resolveStoryHtmlWith({ path: file }, env)).html).toBe(html);
  });

  it('compiles a .twee file with the installed format', async () => {
    const { html } = await resolveStoryHtmlWith({ path: tweeFile }, env);
    expect(html).toContain('<tw-storydata');
    expect(html).toContain('name="Next"');
  });

  it('compiles a project directory, using its twee-ts.config.json sources', async () => {
    const dir = join(tmp, 'project');
    await mkdir(join(dir, 'story'), { recursive: true });
    await mkdir(join(dir, 'other'), { recursive: true });
    await writeFile(
      join(dir, 'twee-ts.config.json'),
      JSON.stringify({ sources: ['story'] }),
    );
    await writeFile(join(dir, 'story', 'a.twee'), TWEE);
    await writeFile(join(dir, 'other', 'b.twee'), ':: Unrelated\nNo\n');
    const { html } = await resolveStoryHtmlWith({ path: dir }, env);
    expect(html).toContain('name="Next"');
    expect(html).not.toContain('name="Unrelated"');
  });

  it('compiles every .tw/.twee file under a directory without a config', async () => {
    const dir = join(tmp, 'plain');
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(join(dir, 'a.twee'), TWEE);
    await writeFile(join(dir, 'sub', 'b.tw'), ':: Extra\nMore\n');
    const { html } = await resolveStoryHtmlWith({ path: dir }, env);
    expect(html).toContain('name="Next"');
    expect(html).toContain('name="Extra"');
  });

  it('compiles a project directory the same from any working directory', async () => {
    const dir = join(tmp, 'project-paths');
    await mkdir(join(dir, 'story'), { recursive: true });
    await writeFile(
      join(dir, 'twee-ts.config.json'),
      JSON.stringify({
        sources: ['story'],
        headFile: 'head.html',
        modules: ['mod.js'],
        exclude: ['story/skip.twee'],
      }),
    );
    await writeFile(join(dir, 'head.html'), '<meta name="head-marker" />');
    await writeFile(join(dir, 'mod.js'), 'window.moduleMarker = 1;');
    await writeFile(join(dir, 'story', 'a.twee'), TWEE);
    await writeFile(join(dir, 'story', 'skip.twee'), ':: Skipped\nNo\n');
    const cwd = process.cwd();
    const elsewhere = join(tmp, 'elsewhere');
    await mkdir(elsewhere, { recursive: true });
    process.chdir(elsewhere);
    try {
      const { html } = await resolveStoryHtmlWith({ path: dir }, env);
      expect(html).toContain('name="head-marker"');
      expect(html).toContain('window.moduleMarker');
      expect(html).toContain('name="Next"');
      expect(html).not.toContain('name="Skipped"');
    } finally {
      process.chdir(cwd);
    }
  });

  it('applies the project exclude from a working directory above the project', async () => {
    const dir = join(tmp, 'project-exclude');
    await mkdir(join(dir, 'story'), { recursive: true });
    await writeFile(
      join(dir, 'twee-ts.config.json'),
      JSON.stringify({ sources: ['story'], exclude: ['story/skip.twee'] }),
    );
    await writeFile(join(dir, 'story', 'a.twee'), TWEE);
    await writeFile(join(dir, 'story', 'skip.twee'), ':: Skipped\nNo\n');
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      const { html } = await resolveStoryHtmlWith({ path: dir }, env);
      expect(html).toContain('name="Next"');
      expect(html).not.toContain('name="Skipped"');
    } finally {
      process.chdir(cwd);
    }
  });

  it('compiles the files a glob matches', async () => {
    const dir = join(tmp, 'globbed');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.twee'), TWEE);
    await writeFile(join(dir, 'b.twee'), ':: Extra\nMore\n');
    const { html } = await resolveStoryHtmlWith(
      { path: join(dir, '*.twee') },
      env,
    );
    expect(html).toContain('name="Next"');
    expect(html).toContain('name="Extra"');
  });

  it('rejects a glob that matches nothing', async () => {
    await expect(
      resolveStoryHtmlWith({ path: join(tmp, 'none-*.twee') }, env),
    ).rejects.toThrow(/no story files match .*none-\*\.twee/);
  });

  it('rejects a project config with no sources', async () => {
    const dir = join(tmp, 'empty-sources');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'twee-ts.config.json'),
      JSON.stringify({ sources: [] }),
    );
    await expect(resolveStoryHtmlWith({ path: dir }, env)).rejects.toThrow(
      /empty-sources has a twee-ts config with no sources/,
    );
  });

  it('rejects with file:line diagnostics when Twee does not compile', async () => {
    const bad = join(tmp, 'bad.twee');
    // A passage name used twice is only a warning in twee-ts; an unterminated
    // metadata block is an error with a location.
    await writeFile(bad, `${STORY_DATA}:: Start {"position":\nHi\n`);
    await expect(resolveStoryHtmlWith({ path: bad }, env)).rejects.toThrow(
      /bad\.twee:\d+: /,
    );
  });

  it('rejects with the install message when twee-ts is missing', async () => {
    await expect(
      resolveStoryHtmlWith(
        { path: tweeFile },
        { ...env, importer: missing('@rohal12/twee-ts') },
      ),
    ).rejects.toThrow(
      'spindle: compiling Twee needs @rohal12/twee-ts; install it with npm i -D @rohal12/twee-ts',
    );
  });

  it('does not need twee-ts to read html', async () => {
    const html = storyHtml({ Start: 'Hi' });
    const { html: read } = await resolveStoryHtmlWith(
      { html },
      { ...env, importer: missing('@rohal12/twee-ts') },
    );
    expect(read).toBe(html);
  });

  it('rejects a path that does not exist', async () => {
    await expect(
      resolveStoryHtmlWith({ path: '/nope.twee' }, env),
    ).rejects.toThrow(/nope\.twee/);
  });
});
