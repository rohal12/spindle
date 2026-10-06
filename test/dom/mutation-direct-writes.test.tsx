// @vitest-environment happy-dom
/**
 * Store updates other than Story.set made while mutation code runs: input
 * bindings, {computed}, {unset} and {goto} in a {link}/{button} body that
 * Story.performAction or a dispatched DOM event runs synchronously, and
 * direct store actions. They take effect in program order, as if the code
 * had made them at that point: the code sees them, its commit neither drops
 * nor reverts them, and actions that record or replace state (navigation,
 * saves) include the code's writes made before them.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { executeMutation } from '../../src/execute-mutation';
import { setByPath } from '../../src/utils/object-path';
import { clearActions, resetIdCounters } from '../../src/action-registry';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(): StoryData {
  const passages = [makePassage(1, 'Start', ''), makePassage(2, 'Room', '')];
  return {
    name: 'Test',
    startNode: 1,
    ifid: 'mutation-direct-writes',
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

type Rec = Record<string, unknown>;
const g = globalThis as Rec;
const state = () => useStoryStore.getState();
const vars = () => state().variables;
const run = (code: string) => executeMutation(code, {}, () => {});

beforeEach(() => {
  clearActions();
  resetIdCounters();
  state().init(
    makeStoryData(),
    { obj: { a: 0, b: 0 }, n: 0, name: '' },
    { t: { a: 0 } },
  );
  installStoryAPI();
});

afterEach(() => {
  delete g.ext;
  delete g.perform;
  vi.restoreAllMocks();
});

describe('direct store updates during mutation code', () => {
  it('a later direct write wins over an earlier code write to the same path', () => {
    g.ext = () =>
      state().updateVariables((d) => {
        (d.variables.obj as Rec).a = 2;
      });
    run('$obj.a = 1; ext(); _seen = $obj.a');
    expect(vars().obj).toEqual({ a: 2, b: 0 });
    expect(state().temporary.seen).toBe(2);
  });

  it('a later code write wins over an earlier direct write', () => {
    g.ext = () => state().setVariable('n', 5);
    run('ext(); _seen = $n; $n = 6');
    expect(vars().n).toBe(6);
    expect(state().temporary.seen).toBe(5);
  });

  it('the code sees direct temporary and transient writes', () => {
    g.ext = () =>
      useStoryStore.setState((s) => {
        s.temporary.tmp = 1;
        (s.transient.t as Rec).a = 2;
      });
    run('_before = typeof _tmp; ext(); _after = _tmp; _ta = %t.a');
    expect(state().temporary).toMatchObject({
      before: 'undefined',
      after: 1,
      ta: 2,
    });
  });

  it('a direct delete removes what the code wrote before it', () => {
    g.ext = () => state().deleteVariable('fresh');
    run('$fresh = 1; ext()');
    expect(Object.keys(vars())).not.toContain('fresh');
  });

  it('a direct path write goes into an object the code created', () => {
    g.ext = () =>
      state().updateVariables((d) => {
        setByPath(d.variables, ['obj', 'c', 'name'], 'Bo', {
          createMissing: true,
        });
      });
    run('$obj.c = { age: 3 }; ext()');
    expect(vars().obj).toEqual({ a: 0, b: 0, c: { age: 3, name: 'Bo' } });
  });

  it('a direct update reads the code’s pending state', () => {
    g.ext = () =>
      state().updateVariables((d) => {
        d.variables.n = (d.variables.n as number) + 1;
      });
    run('$n = 10; ext()');
    expect(vars().n).toBe(11);
  });

  it('the store holds what a write replaced as the code has it', () => {
    let seen: unknown;
    g.ext = () => {
      window.Story.set('obj', { a: 1, b: 2 });
      seen = state().variables.obj;
    };
    run('$obj.a = 1; $obj.c = 3; ext()');
    expect(seen).toEqual({ a: 1, b: 2 });
    expect(vars().obj).toEqual({ a: 1, b: 2 });
  });

  it('a direct navigation records the code’s writes made before it', () => {
    g.ext = () => state().navigate('Room');
    run('$n = 1; _tmp = 1; ext(); _after = typeof _tmp; $n = 2');
    expect(state().currentPassage).toBe('Room');
    expect(state().getHistoryVariables(1).n).toBe(1);
    expect(vars().n).toBe(2);
    expect(state().temporary.after).toBe('undefined');
    state().goBack();
    state().goForward();
    expect(vars().n).toBe(1);
  });

  it('a direct save includes the code’s writes made before it', () => {
    let saved: Rec | undefined;
    g.ext = () => {
      saved = state().getSavePayload().variables as Rec;
    };
    run('$n = 3; ext()');
    expect(saved?.n).toBe(3);
  });
});

describe('macros reacting synchronously to mutation code', () => {
  const performAll = (type: string, value?: unknown) => {
    for (const action of window.Story.getActions()) {
      if (action.type === type) window.Story.performAction(action.id, value);
    }
  };

  beforeEach(() => {
    g.perform = performAll;
  });

  it('an input binding performed by the code', () => {
    renderMarkup('{textbox "$name"}');
    run('$name = "a"; perform("textbox", "b"); _seen = $name');
    expect(vars().name).toBe('b');
    expect(state().temporary.seen).toBe('b');
  });

  it('an input event the code dispatches', () => {
    const el = renderMarkup('{textbox "$name"}');
    g.ext = () => {
      const input = el.querySelector('input')!;
      input.value = 'typed';
      input.dispatchEvent(new Event('input'));
    };
    run('$name = "a"; ext(); _seen = $name');
    expect(vars().name).toBe('typed');
    expect(state().temporary.seen).toBe('typed');
  });

  it('{unset} and {computed} in a link body the code performs', () => {
    renderMarkup('{link "L"}{unset $n}{computed $twice = $obj.a * 2}{/link}');
    run('$n = 1; $obj.a = 4; perform("link"); _n = typeof $n; _twice = $twice');
    expect(Object.keys(vars())).not.toContain('n');
    expect(vars().twice).toBe(8);
    expect(state().temporary).toMatchObject({ n: 'undefined', twice: 8 });
  });

  it('{goto} in a link body the code performs', () => {
    renderMarkup('{link "L"}{goto "Room"}{/link}');
    run('$n = 1; perform("link"); $n = 2');
    expect(state().currentPassage).toBe('Room');
    expect(state().getHistoryVariables(1).n).toBe(1);
    expect(vars().n).toBe(2);
  });

  it('a link to a passage the code performs', () => {
    renderMarkup('{link "L" "Room"}{/link}');
    run('$n = 1; perform("link"); $n = 2');
    expect(state().currentPassage).toBe('Room');
    expect(state().getHistoryVariables(1).n).toBe(1);
    expect(vars().n).toBe(2);
  });

  it('a back button the code performs', () => {
    state().navigate('Room');
    renderMarkup('{back}');
    run('$n = 1; _t = 1; perform("back"); _n = $n; $m = 2');
    expect(state().currentPassage).toBe('Start');
    expect(state().temporary).toEqual({ n: 0 });
    expect(vars().m).toBe(2);
  });
});
