// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage as PassageData } from '../../src/parser';

// Issue #221: {for} iteration keys must reflect Map/Set (and other non-JSON)
// contents, so a content change remounts the iteration with a fresh local
// scope — consistent with plain objects (#45).

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

function renderPassage(content: string): HTMLElement {
  const container = document.createElement('div');
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  return container;
}

function storySet(name: string, value: unknown) {
  act(() => {
    window.Story.set(name, value);
  });
}

describe('{for} iteration keys for non-JSON values (#221)', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'Start')]), {
        items: [new Map([['x', 1]])],
      });
    installStoryAPI();
  });

  it('remounts the iteration when a Map item changes contents', () => {
    const el = renderPassage(
      '{for @item of $items}{set @copy = @item.get("x")}{print @copy}{/for}',
    );
    expect(el.textContent).toBe('1');

    storySet('items', [new Map([['x', 2]])]);
    expect(el.textContent).toBe('2');
  });

  it('remounts the iteration when a Set item changes contents', () => {
    storySet('items', [new Set(['a'])]);
    const el = renderPassage(
      '{for @item of $items}{set @copy = [...@item].join()}{print @copy}{/for}',
    );
    expect(el.textContent).toBe('a');

    storySet('items', [new Set(['b'])]);
    expect(el.textContent).toBe('b');
  });

  it('renders BigInt items without throwing and remounts on change', () => {
    storySet('items', [1n]);
    const el = renderPassage(
      '{for @item of $items}{set @copy = String(@item)}{print @copy}{/for}',
    );
    expect(el.textContent).toBe('1');

    storySet('items', [2n]);
    expect(el.textContent).toBe('2');
  });

  it('keeps plain-object content-change remount behavior (#45)', () => {
    storySet('items', [{ x: 1 }]);
    const el = renderPassage(
      '{for @item of $items}{set @copy = @item.x}{print @copy}{/for}',
    );
    expect(el.textContent).toBe('1');

    storySet('items', [{ x: 2 }]);
    expect(el.textContent).toBe('2');
  });
});
