// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import {
  registerWidget,
  clearWidgets,
} from '../../src/widgets/widget-registry';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import type { ASTNode } from '../../src/markup/ast';
import type { StoryData, Passage as PassageData } from '../../src/parser';

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
    render(<Passage passage={makePassage(1, 'Test', content)} />, container);
  });
  return container;
}

/** Register a widget from definition markup, mimicking boot-time logic. */
function defineWidget(markup: string): void {
  for (const node of buildAST(tokenize(markup))) {
    if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
      const parts = node.rawArgs.trim().split(/\s+/);
      const name = parts[0]!.replace(/["']/g, '');
      const params = parts.slice(1).filter((t) => t.startsWith('@'));
      registerWidget(name, node.children as ASTNode[], params, false);
    }
  }
}

describe('sequential @local assignments (#166)', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  afterEach(() => {
    clearWidgets();
  });

  it('second {set} in a for-loop sees the local assigned by the first', () => {
    const el = renderPassage(
      '{for @item of [1]}{set @a = 5}{set @b = @a + 1}<span id="result">{@a}:{@b}</span>{/for}',
    );
    expect(el.querySelector('#result')!.textContent).toBe('5:6');
  });

  it('chains several assignments to the same local in a for-loop', () => {
    const el = renderPassage(
      '{for @item of [10, 20]}{set @n = @item}{set @n = @n + 1}{set @n = @n * 2}<span class="r">{@n}</span>{/for}',
    );
    const results = Array.from(el.querySelectorAll('.r')).map(
      (n) => n.textContent,
    );
    expect(results).toEqual(['22', '42']);
  });

  it('a story variable assigned from a freshly set local sees its value', () => {
    renderPassage(
      '{for @item of [3]}{set @a = @item * 2}{set $out = @a}{/for}',
    );
    expect(useStoryStore.getState().variables.out).toBe(6);
  });

  it('second {set} in a parameterized widget sees the first assignment', () => {
    defineWidget(
      '{widget "Calc" @x}{set @a = @x * 2}{set @b = @a + 1}<span id="w">{@a}:{@b}</span>{/widget}',
    );
    const el = renderPassage('{Calc 5}');
    expect(el.querySelector('#w')!.textContent).toBe('10:11');
  });

  it('button body updates then reads the same local', () => {
    const el = renderPassage(
      '{for @item of [4]}{button "Go"}{set @a = @item + 1}{set $out = @a * 10}{/button}{/for}',
    );
    act(() => {
      (el.querySelector('button.macro-button') as HTMLElement).click();
    });
    expect(useStoryStore.getState().variables.out).toBe(50);
  });

  it('link body updates then reads the same local', () => {
    const el = renderPassage(
      '{for @item of [4]}{link "Go"}{set @a = @item + 2}{set $out = @a * 10}{/link}{/for}',
    );
    act(() => {
      (el.querySelector('a.macro-link') as HTMLElement).click();
    });
    expect(useStoryStore.getState().variables.out).toBe(60);
  });

  it('button body evaluates {if} against a local set earlier in the body', () => {
    const el = renderPassage(
      '{for @item of [1]}{button "Go"}{set @a = 5}{if @a == 5}{set $out = "yes"}{/if}{/button}{/for}',
    );
    act(() => {
      (el.querySelector('button.macro-button') as HTMLElement).click();
    });
    expect(useStoryStore.getState().variables.out).toBe('yes');
  });

  it('link body evaluates {if} against a local set earlier in the body', () => {
    const el = renderPassage(
      '{for @item of [1]}{link "Go"}{set @a = "x"}{if @a == "x"}{set $out = @a + @item}{/if}{/link}{/for}',
    );
    act(() => {
      (el.querySelector('a.macro-link') as HTMLElement).click();
    });
    expect(useStoryStore.getState().variables.out).toBe('x1');
  });

  it('button body in a widget updates then reads the same local', () => {
    defineWidget(
      '{widget "Btn" @x}{button "Go"}{set @x = @x + 1}{set $out = @x}{/button}{/widget}',
    );
    const el = renderPassage('{Btn 7}');
    act(() => {
      (el.querySelector('button.macro-button') as HTMLElement).click();
    });
    expect(useStoryStore.getState().variables.out).toBe(8);
  });

  it('repeated clicks accumulate a local updated in a button body', () => {
    const el = renderPassage(
      '{for @item of [1]}{set @count = 0}{button "Inc"}{set @count = @count + 1}{set $out = @count}{/button}{/for}',
    );
    const btn = el.querySelector('button.macro-button') as HTMLElement;
    act(() => btn.click());
    act(() => btn.click());
    act(() => btn.click());
    expect(useStoryStore.getState().variables.out).toBe(3);
  });
});

describe('nested @local mutations (#203)', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'Start')]), {
        items: [{ name: 'old' }],
      });
  });

  afterEach(() => {
    clearWidgets();
  });

  it('updates a field of a loop item taken from story state', () => {
    const el = renderPassage(
      '{for @item of $items}{set @item.name = "new"}<span id="r">{@item.name}</span>{/for}',
    );
    expect(el.querySelector('#r')!.textContent).toBe('new');
  });

  it('leaves the source collection unchanged (locals are copies)', () => {
    const before = useStoryStore.getState().variables.items;
    renderPassage(
      '{for @item of $items}{set @item.name = "new"}{@item.name}{/for}',
    );
    const after = useStoryStore.getState().variables.items;
    expect(after).toEqual([{ name: 'old' }]);
    expect(after).toBe(before);
  });

  it('updates a field of an unfrozen local object', () => {
    const el = renderPassage(
      '{for @i of [1]}{set @o = {n: 1}}{set @o.n = @o.n + 1}<span id="r">{@o.n}</span>{/for}',
    );
    expect(el.querySelector('#r')!.textContent).toBe('2');
  });

  it('applies in-place array methods on a local', () => {
    const el = renderPassage(
      '{for @i of [1]}{set @list = [1]}{do}@list.push(2){/do}<span id="r">{@list.length}</span>{/for}',
    );
    expect(el.querySelector('#r')!.textContent).toBe('2');
  });

  it('updates a field of an object widget argument', () => {
    defineWidget(
      '{widget "Show" @arg}{set @arg.x = 1}<span id="w">{@arg.x}</span>{/widget}',
    );
    const el = renderPassage('{set $obj = {x: 0}}{Show $obj}');
    expect(el.querySelector('#w')!.textContent).toBe('1');
    expect(useStoryStore.getState().variables.obj).toEqual({ x: 0 });
  });

  it('accumulates nested local updates across button clicks', () => {
    const el = renderPassage(
      '{for @item of $items}{button "Go"}{set @item.name = @item.name + "!"}{set $out = @item.name}{/button}{/for}',
    );
    const btn = el.querySelector('button.macro-button') as HTMLElement;
    act(() => btn.click());
    act(() => btn.click());
    expect(useStoryStore.getState().variables.out).toBe('old!!');
    expect(useStoryStore.getState().variables.items).toEqual([{ name: 'old' }]);
  });
});
