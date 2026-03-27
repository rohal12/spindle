// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
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

function renderMarkup(markup: string): HTMLElement {
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  const container = document.createElement('div');
  render(<>{renderNodes(ast)}</>, container);
  return container;
}

describe('transient variables integration', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(
      makeStoryData([
        makePassage(1, 'Start', 'Start'),
        makePassage(2, 'Page2', '{%x}'),
      ]),
      { health: 100 },
      { x: 0, list: ['a', 'b', 'c'] },
    );
  });

  it('{%var} displays transient value', () => {
    useStoryStore.getState().setTransient('x', 42);
    const el = renderMarkup('{%x}');
    expect(el.textContent).toBe('42');
  });

  it('{set %x = 5} writes to transient store', () => {
    const el = renderMarkup('{set %x = 5}{%x}');
    expect(el.textContent).toBe('5');
    expect(useStoryStore.getState().transient.x).toBe(5);
    expect(useStoryStore.getState().variables).not.toHaveProperty('x');
  });

  it('{unset %x} removes from transient', () => {
    useStoryStore.getState().setTransient('x', 10);
    const el = renderMarkup('{unset %x}{%x}');
    expect(el.textContent).toBe('');
  });

  it('{if %x > 3} conditional with transient', () => {
    useStoryStore.getState().setTransient('x', 5);
    const el = renderMarkup('{if %x > 3}yes{else}no{/if}');
    expect(el.textContent).toContain('yes');
  });

  it('{for @item of %list} iterates transient array', () => {
    const el = renderMarkup('{for @item of %list}{@item}{/for}');
    expect(el.textContent).toContain('a');
    expect(el.textContent).toContain('b');
    expect(el.textContent).toContain('c');
  });

  it('transient values survive navigation', () => {
    act(() => {
      useStoryStore.getState().setTransient('x', 42);
      useStoryStore.getState().navigate('Page2');
    });
    expect(useStoryStore.getState().transient.x).toBe(42);
  });

  it('transient values stay current on goBack', () => {
    act(() => {
      useStoryStore.getState().navigate('Page2');
      useStoryStore.getState().setTransient('x', 99);
      useStoryStore.getState().goBack();
    });
    expect(useStoryStore.getState().transient.x).toBe(99);
  });

  it('transient excluded from save payload', () => {
    useStoryStore.getState().setTransient('x', { huge: 'data' });
    const payload = useStoryStore.getState().getSavePayload();
    expect(payload.variables).not.toHaveProperty('x');
    expect((payload as any).transient).toBeUndefined();
  });

  it('transient resets to defaults on restart', () => {
    useStoryStore.getState().setTransient('x', 99);
    useStoryStore.getState().restart();
    expect(useStoryStore.getState().transient.x).toBe(0);
  });
});
