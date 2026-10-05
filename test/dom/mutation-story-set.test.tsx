// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST, unregisterBlockMacro } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { defineMacro } from '../../src/define-macro';
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
  const container = document.createElement('div');
  act(() => {
    render(<>{renderNodes(buildAST(tokenize(markup)))}</>, container);
  });
  return container;
}

describe('Story.set inside mutation macros', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(
        makeStoryData([makePassage(1, 'Start', '')]),
        { data: { value: 0 }, list: [1], obj: { a: 0, b: 0 } },
        { tdata: { value: 0 } },
      );
    installStoryAPI();
  });

  afterEach(() => {
    unregisterBlockMacro('extset');
  });

  it('{do} keeps a Story.set object update', () => {
    const el = renderMarkup(
      '{do}Story.set("data", { value:9 });{/do}{print $data.value}',
    );
    expect(el.textContent).toBe('9');
    expect(useStoryStore.getState().variables.data).toEqual({ value: 9 });
  });

  it('{do} keeps Story.set array and transient object updates', () => {
    renderMarkup(
      '{do}Story.set("list", [4, 5]); Story.set("%tdata", { value: 3 });{/do}',
    );
    const state = useStoryStore.getState();
    expect(state.variables.list).toEqual([4, 5]);
    expect(state.transient.tdata).toEqual({ value: 3 });
  });

  it('{do} keeps a nested Story.set write to a root the code changed (#215)', () => {
    const el = renderMarkup(
      '{do}$obj.a = 1; Story.set("obj.b", 2);{/do}{print $obj.a}-{print $obj.b}',
    );
    expect(el.textContent).toBe('1-2');
    expect(useStoryStore.getState().variables.obj).toEqual({ a: 1, b: 2 });
  });

  it('custom ctx.mutate keeps a Story.set object update', () => {
    defineMacro({
      name: 'extset',
      render(_props, ctx) {
        ctx.hooks.useLayoutEffect(() => {
          ctx.mutate('Story.set("data", { value: 7 }); $list.push(2)');
        }, []);
        return null;
      },
    });
    renderMarkup('{extset}');
    const vars = useStoryStore.getState().variables;
    expect(vars.data).toEqual({ value: 7 });
    expect(vars.list).toEqual([1, 2]);
  });
});
