// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { executeMutation } from '../../src/execute-mutation';
import { clearActions, resetIdCounters } from '../../src/action-registry';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(): StoryData {
  const passages = [makePassage(1, 'Start', '')];
  return {
    name: 'Test',
    startNode: 1,
    ifid: 'regressions-487-488',
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
  document.body.appendChild(container);
  act(() => {
    render(<>{renderNodes(parseMarkup(markup))}</>, container);
  });
  return container;
}

type Rec = Record<string, unknown>;
const g = globalThis as Rec;
const state = () => useStoryStore.getState();
const vars = () => state().variables;

beforeEach(() => {
  clearActions();
  resetIdCounters();
  state().init(
    makeStoryData(),
    { theme: 'dark', name: '', agree: false, out: false, n: 0 },
    {},
  );
  installStoryAPI();
});

afterEach(() => {
  document.body.innerHTML = '';
  delete g.ext;
});

describe('dynamic selectors on the visible built-in macros (#487)', () => {
  // [macro, markup after the selectors, tag the id lands on]
  const cases: [string, string, string | undefined][] = [
    ['span', 'span}Text{/span}', 'span'],
    ['nobr', 'nobr}Text{/nobr}', 'span'],
    ['story-title', 'story-title}', undefined],
    ['textbox', 'textbox $name}', 'input'],
    ['numberbox', 'numberbox $n}', 'input'],
    ['textarea', 'textarea $name}', 'textarea'],
    ['checkbox', 'checkbox $agree}', 'label'],
    ['radiobutton', 'radiobutton $name "a" "A"}', 'label'],
    ['listbox', 'listbox $name}{option "a"}{option "b"}{/listbox}', 'select'],
    ['cycle', 'cycle $name}{option "a"}{option "b"}{/cycle}', 'button'],
    ['back', 'back}', 'button'],
    ['quicksave', 'quicksave}', 'button'],
    ['restart', 'restart}', 'button'],
  ];

  it.each(cases)('resolves them on {%s}', (_macro, rest, tag) => {
    const el = renderMarkup(`{.{$theme}#x-{$theme} ${rest}`);
    const found = el.querySelector('#x-dark');
    expect(found).not.toBeNull();
    if (tag) expect(found!.tagName.toLowerCase()).toBe(tag);
    expect(found!.classList.contains('dark')).toBe(true);
    expect(el.innerHTML).not.toContain('{$theme}');
  });

  it('follows the variable when it changes', () => {
    const el = renderMarkup('{.{$theme}#id-{$theme} span}Text{/span}');
    expect(el.querySelector('#id-dark')).not.toBeNull();
    act(() => state().setVariable('theme', 'light'));
    expect(el.querySelector('#id-light.light')).not.toBeNull();
    expect(el.querySelector('#id-dark')).toBeNull();
  });

  it('names an input control action by its resolved ID', () => {
    renderMarkup('{#in-{$theme} textbox $name}');
    expect(window.Story.getActions().map((a) => a.id)).toContain('in-dark');
  });

  it('leaves a custom macro without interpolate unresolved', () => {
    let seen: { className?: string; id?: string } = {};
    window.Story.defineMacro({
      name: 'ctx-selectors',
      render(props, ctx) {
        seen = { className: props.className, id: ctx.id };
        return null;
      },
    });
    renderMarkup('{.{$theme}#x-{$theme} ctx-selectors}');
    expect(seen).toEqual({ className: '{$theme}', id: 'x-{$theme}' });
  });

  it('resolves them on a custom macro with interpolate', () => {
    let seen: { className?: string; id?: string } = {};
    window.Story.defineMacro({
      name: 'ctx-resolved',
      interpolate: true,
      render(_props, ctx) {
        seen = { className: ctx.className, id: ctx.id };
        return null;
      },
    });
    renderMarkup('{.{$theme}#x-{$theme} ctx-resolved}');
    expect(seen).toEqual({ className: 'dark', id: 'x-dark' });
  });
});

describe('checkbox toggles from the current value (#488)', () => {
  const click = (el: HTMLElement) => act(() => el.click());

  it('toggles the value mutation code has just set', () => {
    const el = renderMarkup(
      '{checkbox $agree}{button "Test"}{do}$agree = true; Story.performAction("checkbox:$agree"); $out = $agree;{/do}{/button}',
    );
    click(el.querySelector('button')!);
    expect(vars().agree).toBe(false);
    expect(vars().out).toBe(false);
  });

  it('toggles twice in one synchronous run', () => {
    renderMarkup('{checkbox $agree}');
    executeMutation(
      'Story.performAction("checkbox:$agree"); Story.performAction("checkbox:$agree");',
      {},
      () => {},
    );
    expect(vars().agree).toBe(false);
  });

  it('keeps an explicit action value', () => {
    renderMarkup('{checkbox $agree}');
    executeMutation(
      'Story.performAction("checkbox:$agree", true); Story.performAction("checkbox:$agree", true);',
      {},
      () => {},
    );
    expect(vars().agree).toBe(true);
  });

  it('sets the value to what the input shows on a DOM change', () => {
    const el = renderMarkup('{checkbox $agree}');
    const input = el.querySelector('input')!;
    g.ext = () => {
      input.checked = false;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };
    executeMutation('$agree = true; ext();', {}, () => {});
    expect(vars().agree).toBe(false);
  });

  it('still follows a click from the reader', () => {
    const el = renderMarkup('{checkbox $agree}');
    click(el.querySelector('input')!);
    expect(vars().agree).toBe(true);
    click(el.querySelector('input')!);
    expect(vars().agree).toBe(false);
  });
});
