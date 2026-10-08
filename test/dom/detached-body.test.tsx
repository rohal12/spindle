// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import {
  registerWidget,
  clearWidgets,
} from '../../src/widgets/widget-registry';
import { parseMarkup } from '../../src/markup/parse';
import { registerBlockMacro, unregisterBlockMacro } from '../../src/markup/ast';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import type { ASTNode } from '../../src/markup/ast';
import { NobrContext } from '../../src/markup/render';
import { DialogCloseContext } from '../../src/components/PassageDialog';
import { defineMacro } from '../../src/define-macro';
import type { StoryData, Passage as PassageData } from '../../src/parser';

/*
 * {button} and {link} run their body on click by rendering it into a
 * detached node. The body must see the same contexts it would see rendered
 * in place: the enclosing widget's {@children}, {repeat}'s {stop}, ...
 */

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

const blockWidgets: string[] = [];

/** Register a widget from definition markup, mimicking boot-time logic. */
function defineWidget(markup: string): void {
  for (const node of parseMarkup(markup)) {
    if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
      const parts = node.rawArgs.trim().split(/\s+/);
      const name = parts[0]!.replace(/["']/g, '');
      const params = parts.slice(1).filter((t) => t.startsWith('@'));
      const children = node.children as ASTNode[];
      const isBlock = astContainsChildren(children);
      registerWidget(name, children, params, isBlock);
      if (isBlock) {
        registerBlockMacro(name);
        blockWidgets.push(name);
      }
    }
  }
}

describe('detached {button}/{link} bodies', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  afterEach(() => {
    clearWidgets();
    for (const name of blockWidgets) unregisterBlockMacro(name);
    blockWidgets.length = 0;
    vi.useRealTimers();
  });

  it('runs a block widget’s {@children} from a {button} body', () => {
    defineWidget('{widget "Buy"}{button "Buy"}{@children}{/button}{/widget}');
    const el = renderPassage('{Buy}{set $bought = true}{/Buy}');
    expect(useStoryStore.getState().variables.bought).toBeUndefined();
    act(() => (el.querySelector('button') as HTMLElement).click());
    expect(useStoryStore.getState().variables.bought).toBe(true);
  });

  it('runs a block widget’s {@children} from a {link} body', () => {
    defineWidget('{widget "Act"}{link "Do it"}{@children}{/link}{/widget}');
    const el = renderPassage('{Act}{set $done = 1}{/Act}');
    act(() => (el.querySelector('a.macro-link') as HTMLElement).click());
    expect(useStoryStore.getState().variables.done).toBe(1);
  });

  it('runs {@children} with the widget’s locals from a {button} body', () => {
    defineWidget(
      '{widget "Each" @n}{button "Go"}{set @twice = @n * 2}{@children}{/button}{/widget}',
    );
    const el = renderPassage('{Each 4}{set $out = @twice}{/Each}');
    act(() => (el.querySelector('button') as HTMLElement).click());
    expect(useStoryStore.getState().variables.out).toBe(8);
  });

  it('passes the nobr mode and dialog close callback to the body', () => {
    const seen: Array<{ nobr: boolean; close: unknown }> = [];
    defineMacro({
      name: 'probe-body-context',
      render(_props, ctx) {
        seen.push({
          nobr: ctx.hooks.useContext(NobrContext),
          close: ctx.hooks.useContext(DialogCloseContext),
        });
        return null;
      },
    });
    const close = () => {};
    const container = document.createElement('div');
    act(() => {
      render(
        <DialogCloseContext.Provider value={close}>
          <Passage
            passage={{
              ...makePassage(
                1,
                'Test',
                '{button "Go"}{probe-body-context}{/button}',
              ),
              tags: ['nobr'],
            }}
          />
        </DialogCloseContext.Provider>,
        container,
      );
    });
    act(() => (container.querySelector('button') as HTMLElement).click());
    expect(seen).toEqual([{ nobr: true, close }]);
  });

  it('{stop} in a {button} body stops the enclosing {repeat}', () => {
    vi.useFakeTimers();
    const el = renderPassage(
      '{repeat 100ms}{set $n = ($n ?? 0) + 1}{button "Stop"}{stop}{/button}{/repeat}',
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const n = useStoryStore.getState().variables.n as number;
    expect(n).toBeGreaterThan(0);

    act(() => (el.querySelector('button') as HTMLElement).click());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useStoryStore.getState().variables.n).toBe(n);
  });

  it('{stop} in a {link} body stops the enclosing {repeat}', () => {
    vi.useFakeTimers();
    const el = renderPassage(
      '{repeat 100ms}{set $n = ($n ?? 0) + 1}{link "Stop"}{stop}{/link}{/repeat}',
    );
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const n = useStoryStore.getState().variables.n as number;

    act(() => (el.querySelector('a.macro-link') as HTMLElement).click());
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(useStoryStore.getState().variables.n).toBe(n);
  });

  it('keeps a {timed} in a {button} body alive until it runs', () => {
    vi.useFakeTimers();
    const el = renderPassage(
      '{button "Start"}{timed 50ms}{set $late = 1}{/timed}{/button}',
    );
    act(() => (el.querySelector('button') as HTMLElement).click());
    expect(useStoryStore.getState().variables.late).toBeUndefined();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(useStoryStore.getState().variables.late).toBe(1);
  });

  it('does not re-run a skipped branch when the state changes later (#351)', () => {
    const el = renderPassage(
      '{button "Check"}{if $n > 10}{set $hits += 1}{/if}{/button}{button "Up"}{set $n = 20}{/button}',
    );
    useStoryStore.setState({ variables: { n: 10, hits: 0 } });
    const [check, up] = Array.from(el.querySelectorAll('button'));
    act(() => (check as HTMLElement).click());
    act(() => (up as HTMLElement).click());
    expect(useStoryStore.getState().variables.hits).toBe(0);
  });

  it('toggles once per click (#351)', () => {
    const el = renderPassage(
      '{button "T"}{if $active}{set $active = false}{else}{set $active = true}{/if}{/button}',
    );
    useStoryStore.setState({ variables: { active: false } });
    act(() => (el.querySelector('button') as HTMLElement).click());
    expect(useStoryStore.getState().variables.active).toBe(true);
  });

  it('applies invocation selectors to a widget (#358)', () => {
    defineWidget('{widget "Stats"}Stats content{/widget}');
    const el = renderPassage('{.badge#hero Stats}');
    const target = el.querySelector('#hero');
    expect(target?.classList.contains('badge')).toBe(true);
    expect(target?.textContent).toContain('Stats content');
  });

  it('resolves dynamic invocation selectors on a widget (#365)', () => {
    defineWidget('{widget "Badge"}Badge{/widget}');
    const el = renderPassage('{.{$theme}#{$theme} Badge}');
    act(() => useStoryStore.setState({ variables: { theme: 'red' } }));
    expect(el.querySelector('#red.red')).not.toBeNull();
    act(() => useStoryStore.setState({ variables: { theme: 'blue' } }));
    expect(el.querySelector('#blue.blue')).not.toBeNull();
    expect(el.querySelector('#red')).toBeNull();
  });

  it('keeps the selectors of the selected switch branch (#366)', () => {
    const el = renderPassage(
      '{switch $x}{.highlight#selected case 1}Selected{.fallback#other default}Other{/switch}',
    );
    act(() => useStoryStore.setState({ variables: { x: 1 } }));
    expect(el.querySelector('#selected.highlight')?.textContent).toBe(
      'Selected',
    );
    act(() => useStoryStore.setState({ variables: { x: 2 } }));
    expect(el.querySelector('#other.fallback')?.textContent).toBe('Other');
    expect(el.querySelector('#selected')).toBeNull();
  });

  it('updates rendered() consumers when an include mounts (#355)', () => {
    const data = makeStoryData([
      makePassage(1, 'Start', ''),
      makePassage(2, 'Info', 'Count: {print rendered("Info")}'),
    ]);
    useStoryStore.setState({ storyData: data });
    const el = renderPassage('{include "Info"}Outer: {print rendered("Info")}');
    expect(el.textContent).toContain('Count: 1');
    expect(el.textContent).toContain('Outer: 1');
  });
});
