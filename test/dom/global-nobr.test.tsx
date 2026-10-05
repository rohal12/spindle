// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../../src/components/App';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { resetTriggers } from '../../src/triggers';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(
  pid: number,
  name: string,
  content: string,
  tags: string[] = [],
): Passage {
  return { pid, name, tags, metadata: {}, content };
}

function makeStoryData(passages: Passage[]): StoryData {
  return {
    name: 'Global nobr',
    startNode: 1,
    ifid: 'global-nobr',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

const PROSE =
  'First paragraph.\n\nSecond paragraph.\n<div class="box">Inside a div.</div>\n{if true}Inside an if.{/if}';

/**
 * Pins the documented semantics of Story.setNobr(true) (#186): nested
 * content loses its <p> wrapping, a passage's own top-level text keeps
 * its paragraphs unless the passage is tagged [nobr].
 */
describe('Story.setNobr', () => {
  let container: HTMLElement;

  function boot(passages: Passage[], globalNobr: boolean): void {
    resetTriggers();
    useStoryStore.getState().init(makeStoryData(passages));
    installStoryAPI();
    window.Story.setNobr(globalNobr);
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(<App />, container);
    });
  }

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    container.remove();
    window.Story.setNobr(false);
  });

  const passageEl = () => container.querySelector('.passage') as HTMLElement;

  describe('off (default)', () => {
    beforeEach(() => boot([makePassage(1, 'Start', PROSE)], false));

    it('wraps top-level and nested text in <p>', () => {
      const ps = Array.from(passageEl().querySelectorAll(':scope > p'));
      expect(ps.map((p) => p.textContent)).toContain('First paragraph.');
      expect(passageEl().querySelector('.box > p')).not.toBeNull();
    });
  });

  describe('on', () => {
    beforeEach(() => boot([makePassage(1, 'Start', PROSE)], true));

    it("keeps the passage's top-level paragraphs", () => {
      const ps = Array.from(passageEl().querySelectorAll(':scope > p'));
      expect(ps.map((p) => p.textContent)).toEqual(
        expect.arrayContaining(['First paragraph.']),
      );
      expect(passageEl().textContent).toContain('Second paragraph.');
      expect(ps.length).toBeGreaterThanOrEqual(2);
    });

    it('does not wrap content nested in HTML elements', () => {
      const box = passageEl().querySelector('.box')!;
      expect(box.querySelector('p')).toBeNull();
      expect(box.textContent).toBe('Inside a div.');
    });

    it('does not wrap content nested in macros', () => {
      const ps = Array.from(passageEl().querySelectorAll('p'));
      expect(ps.some((p) => p.textContent === 'Inside an if.')).toBe(false);
      expect(passageEl().textContent).toContain('Inside an if.');
    });
  });

  describe('[nobr] passage tag', () => {
    beforeEach(() => boot([makePassage(1, 'Start', PROSE, ['nobr'])], false));

    it('removes top-level and nested <p> wrapping', () => {
      expect(passageEl().querySelector('p')).toBeNull();
      expect(passageEl().textContent).toContain('First paragraph.');
    });
  });
});

describe('dialogs and the [nobr] tag', () => {
  let container: HTMLElement;

  beforeEach(() => {
    resetTriggers();
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(1, 'Start', 'Hello'),
          makePassage(2, 'Plain', 'One.\n\nTwo.'),
          makePassage(3, 'Bare', 'One.\n\nTwo.\n<div class="box">Box.</div>', [
            'nobr',
          ]),
        ]),
      );
    installStoryAPI();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(<App />, container);
    });
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    container.remove();
  });

  const body = () => container.querySelector('.dialog-body') as HTMLElement;

  it('wraps an untagged dialog passage in <p>', () => {
    act(() => window.Story.openDialog('Plain'));
    expect(body().querySelectorAll('p')).toHaveLength(2);
  });

  it("honours the dialog passage's [nobr] tag", () => {
    act(() => window.Story.openDialog('Bare'));
    expect(body().querySelector('p')).toBeNull();
    expect(body().textContent).toContain('Two.');
    expect(body().querySelector('.box')!.textContent).toBe('Box.');
  });
});
