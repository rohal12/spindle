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
import { parseMarkup } from '../../src/markup/parse';
import type { ASTNode } from '../../src/markup/ast';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function setup(vars: Record<string, unknown>): void {
  const passages = [makePassage(1, 'Start', 'Start')];
  const data: StoryData = {
    name: 'Test',
    startNode: 1,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
  useStoryStore.getState().init(data, vars);
}

function renderPassage(content: string): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  return container;
}

/** Register a widget from definition markup, mimicking boot-time logic. */
function defineWidget(markup: string): void {
  for (const node of parseMarkup(markup)) {
    if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
      const parts = node.rawArgs.trim().split(/\s+/);
      const name = parts[0]!.replace(/["']/g, '');
      const params = parts.slice(1).filter((t) => t.startsWith('@'));
      registerWidget(name, node.children as ASTNode[], params, false);
    }
  }
}

const vars = () => useStoryStore.getState().variables;

describe('locals assigned earlier in the same pass (#489)', () => {
  beforeEach(() => {
    clearWidgets();
    setup({ wrong: false, out: 0 });
  });
  afterEach(() => clearWidgets());

  it('{if} reads a local the preceding {set} assigned', () => {
    renderPassage(
      '{for @i of [1]}{set @ready = true}{if !@ready}{set $wrong = true}{/if}{/for}',
    );
    expect(vars().wrong).toBe(false);
  });

  it('{if} in a widget body reads a local set before it', () => {
    defineWidget(
      '{widget "W" @arg}{set @r = true}{if !@r}{set $wrong = true}{/if}{/widget}',
    );
    renderPassage('{W 1}');
    expect(vars().wrong).toBe(false);
  });

  it('a widget argument reads a local set before the invocation', () => {
    defineWidget('{widget "W" @arg}{set $out = @arg}{/widget}');
    renderPassage('{for @i of [1]}{set @n = 7}{W @n}{/for}');
    expect(vars().out).toBe(7);
  });

  it('a nested {for} list reads a local set before it', () => {
    const el = renderPassage(
      '{for @i of [1]}{set @list = [4, 5]}{for @j of @list}<b class="e">{@j}</b>{/for}{/for}',
    );
    expect(el.querySelector('.error')).toBeNull();
    expect(el.querySelectorAll('.e')).toHaveLength(2);
  });

  it('a nested {for} body sees a local set before the loop', () => {
    renderPassage(
      '{for @i of [1]}{set @n = 7}{for @j of [1]}{if @n != 7}{set $wrong = true}{/if}{/for}{/for}',
    );
    expect(vars().wrong).toBe(false);
  });

  it('a widget body sees a local set before the invocation', () => {
    defineWidget('{widget "W"}{if @n != 7}{set $wrong = true}{/if}{/widget}');
    renderPassage('{for @i of [1]}{set @n = 7}{W}{/for}');
    expect(vars().wrong).toBe(false);
  });

  it('expression displays and variable displays read it', () => {
    const el = renderPassage(
      '{for @i of [1]}{set @n = 7}<b id="a">{@n}</b><b id="b">{@n + 1}</b>{/for}',
    );
    expect(el.querySelector('#a')!.textContent).toBe('7');
    expect(el.querySelector('#b')!.textContent).toBe('8');
  });

  it('still follows a later change of the local', () => {
    const el = renderPassage(
      '{for @i of [1]}{set @n = 1}<b id="a">{@n}</b>{button "Go"}{set @n = @n + 1}{/button}{/for}',
    );
    act(() => (el.querySelector('button') as HTMLElement).click());
    expect(el.querySelector('#a')!.textContent).toBe('2');
  });
});

describe('widget parameters renamed under a mounted invocation (#511)', () => {
  beforeEach(() => {
    clearWidgets();
    setup({ rename: false, tick: 0 });
  });
  afterEach(() => clearWidgets());

  it('passes the unchanged argument to the renamed parameter', () => {
    defineWidget('{widget "W" @a}A:{@a}{/widget}');
    const el = renderPassage(
      '{for @i of [1]}{W 7}{/for}{button "Rename"}{set $rename = true}{/button}',
    );
    expect(el.textContent).toContain('A:7');
    // The definition changes under the mounted invocation (#77)
    defineWidget('{widget "W" @b}B:{@b}{/widget}');
    act(() => (el.querySelector('button') as HTMLElement).click());
    expect(el.textContent).toContain('B:7');
  });
});
