// @vitest-environment happy-dom
/**
 * Passage markup reading the counters of passages named like
 * Object.prototype members or `__proto__` (#235, see
 * test/unit/passage-counters).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage } from '../../src/parser';

const NAMES = ['constructor', 'toString', 'hasOwnProperty', '__proto__'];

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(): StoryData {
  const passages = [
    makePassage(1, 'Start', ''),
    ...NAMES.map((name, i) => makePassage(i + 2, name, 'included')),
  ];
  return {
    name: 'Test',
    startNode: 1,
    ifid: 'passage-counters-dom',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

function renderMarkup(markup: string): HTMLElement {
  const container = document.createElement('div');
  act(() => {
    render(<>{renderNodes(parseMarkup(markup))}</>, container);
  });
  return container;
}

const state = () => useStoryStore.getState();

const COUNTERS = (name: string) =>
  `{print visited("${name}")}/{print rendered("${name}")}` +
  `{if hasVisited("${name}")}+v{/if}` +
  `{if hasRendered("${name}")}+r{/if}`;

beforeEach(() => {
  state().init(makeStoryData(), {}, {});
  installStoryAPI();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('counters of passages named like Object.prototype members', () => {
  it.each(NAMES)('read 0 for %s before a visit', (name) => {
    expect(renderMarkup(COUNTERS(name)).textContent).toBe('0/0');
  });

  it.each(NAMES)('count visits to %s', (name) => {
    state().navigate(name);
    state().navigate('Start');
    state().navigate(name);
    expect(renderMarkup(COUNTERS(name)).textContent).toBe('2/2+v+r');
  });

  it.each(NAMES)('count includes of %s as renders', (name) => {
    expect(renderMarkup(`{include "${name}"}`).textContent).toBe('included');
    expect(renderMarkup(COUNTERS(name)).textContent).toBe('0/1+r');
  });
});
