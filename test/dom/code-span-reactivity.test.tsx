// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

// Issue #223: variables inside markdown code spans were resolved to a plain
// string at renderNodes() time, so they never updated while the memoized
// passage stayed on screen. They must render as subscribed components.

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
  const passage = makePassage(1, 'Test', content);
  const container = document.createElement('div');
  act(() => {
    render(<Passage passage={passage} />, container);
  });
  return container;
}

describe('variables inside markdown code spans (#223)', () => {
  beforeEach(() => {
    useStoryStore.getState().init(
      makeStoryData([makePassage(1, 'Start', 'Start')]),
      { x: 0 },
      {
        t: 0,
      },
    );
  });

  it('updates a story variable inside a code span', () => {
    const el = renderPassage('`{$x}` regular: {$x}');
    expect(el.textContent).toContain('0 regular: 0');
    act(() => {
      useStoryStore.getState().setVariable('x', 2);
    });
    expect(el.querySelector('code')!.textContent).toBe('2');
    expect(el.textContent).toContain('2 regular: 2');
  });

  it('updates a temporary variable inside a code span', () => {
    act(() => {
      useStoryStore.getState().setTemporary('tmp', 'a');
    });
    const el = renderPassage('`tmp={_tmp}`');
    expect(el.querySelector('code')!.textContent).toBe('tmp=a');
    act(() => {
      useStoryStore.getState().setTemporary('tmp', 'b');
    });
    expect(el.querySelector('code')!.textContent).toBe('tmp=b');
  });

  it('updates a transient variable inside a code span', () => {
    const el = renderPassage('`t={%t}`');
    expect(el.querySelector('code')!.textContent).toBe('t=0');
    act(() => {
      useStoryStore.getState().setTransient('t', 7);
    });
    expect(el.querySelector('code')!.textContent).toBe('t=7');
  });

  it('updates dot paths inside a code span', () => {
    act(() => {
      useStoryStore.getState().setVariable('hero', { name: 'Ann' });
    });
    const el = renderPassage('`{$hero.name} ({$hero.name.length})`');
    expect(el.querySelector('code')!.textContent).toBe('Ann (3)');
    act(() => {
      useStoryStore.getState().setVariable('hero', { name: 'Bea' });
    });
    expect(el.querySelector('code')!.textContent).toBe('Bea (3)');
  });

  it('updates expressions inside a code span', () => {
    const el = renderPassage('`{$x + 1}`');
    expect(el.querySelector('code')!.textContent).toBe('1');
    act(() => {
      useStoryStore.getState().setVariable('x', 4);
    });
    expect(el.querySelector('code')!.textContent).toBe('5');
  });

  it('shows markdown characters in values literally', () => {
    act(() => {
      useStoryStore.getState().setVariable('x', '*a* `b` <i>c</i>');
    });
    const el = renderPassage('`{$x}`');
    const code = el.querySelector('code')!;
    expect(code.textContent).toBe('*a* `b` <i>c</i>');
    expect(code.querySelector('em, i')).toBeNull();
  });

  it('keeps text around the code span intact', () => {
    const el = renderPassage('before `a {$x} b` after');
    const p = el.querySelector('p')!;
    expect(p.innerHTML).toBe('before <code>a 0 b</code> after');
  });
});
