// @vitest-environment happy-dom
/**
 * Passages using variable names that are Object.prototype members, and the
 * error for a variable named `__proto__` (see test/unit/variable-names).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { clearWidgets } from '../../src/widgets/widget-registry';
import { defineMacro } from '../../src/define-macro';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(): StoryData {
  const passages = [makePassage(1, 'Start', ''), makePassage(2, 'Room', '')];
  return {
    name: 'Test',
    startNode: 1,
    ifid: 'variable-names-dom',
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

beforeEach(() => {
  state().init(makeStoryData(), {}, {});
  installStoryAPI();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  clearWidgets();
  vi.restoreAllMocks();
});

describe('variables named like Object.prototype members', () => {
  it('display as empty while unset', () => {
    const el = renderMarkup(
      '[{$toString}{_constructor}{%valueOf}{@hasOwnProperty}{print $isPrototypeOf}]',
    );
    expect(el.textContent).toBe('[]');
  });

  it('are false in conditions while unset', () => {
    const el = renderMarkup(
      '{if $constructor || _toString || %valueOf}yes{else}no{/if}',
    );
    expect(el.textContent).toBe('no');
  });

  it('store and display values in every namespace', () => {
    const el = renderMarkup(
      '{set $constructor = 1}{set _toString = 2}{set %valueOf = 3}' +
        '{$constructor}{_toString}{%valueOf}-{print $constructor + _toString}',
    );
    expect(el.textContent).toBe('123-3');
    expect(state().variables.constructor).toBe(1);
    expect(state().temporary.toString).toBe(2);
    expect(state().transient.valueOf).toBe(3);
  });

  it('work as loop and widget locals', () => {
    const el = renderMarkup(
      '{for @valueOf, @toString of ["a", "b"]}{@toString}{@valueOf}{/for}',
    );
    expect(el.textContent).toBe('0a1b');
    renderMarkup('{widget "w" @constructor}<{@constructor}>{/widget}');
    expect(renderMarkup('{w 7}').textContent).toBe('<7>');
  });

  it('can be set and unset as locals', () => {
    const el = renderMarkup(
      '{for @x of [1]}{set @hasOwnProperty = 5}{@hasOwnProperty}{/for}',
    );
    expect(el.textContent).toBe('5');
    const unset = renderMarkup(
      '{for @x of [1]}{set @toString = 5}{unset @toString}{print typeof @toString}{/for}',
    );
    expect(unset.textContent).toBe('undefined');
  });

  it('bind input macros', () => {
    const el = renderMarkup('{textbox "$constructor"}');
    const input = el.querySelector('input')!;
    expect(input.value).toBe('');
    act(() => {
      input.value = 'Bo';
      input.dispatchEvent(new Event('input'));
    });
    expect(state().variables.constructor).toBe('Bo');
  });

  it('take {computed} and {unset}', () => {
    renderMarkup('{computed $toString = 2 + 2}{computed _valueOf = 1}');
    expect(state().variables.toString).toBe(4);
    expect(state().temporary.valueOf).toBe(1);
    renderMarkup('{unset $toString}{unset _valueOf}');
    expect(Object.keys(state().variables)).not.toContain('toString');
    expect(Object.keys(state().temporary)).not.toContain('valueOf');
  });
});

describe('a variable named __proto__', () => {
  it('is refused in {do} code, which logs the error', () => {
    const error = vi.mocked(console.error);
    renderMarkup('{do}$x = 1; $__proto__ = { polluted: 1 }{/do}');
    expect(String(error.mock.calls[0]?.[1])).toMatch(/__proto__/);
    expect(Object.keys(state().variables)).toEqual([]);
  });

  const errorOf = (markup: string) =>
    renderMarkup(markup).querySelector('.error')?.textContent ?? '';

  it.each([
    ['{set $__proto__ = { x: 1 }}'],
    ['{set ___proto__ = 1}'],
    ['{set %__proto__ = 1}'],
    ['{print $__proto__}'],
    ['{$__proto__}'],
    ['{___proto__}'],
    ['{%__proto__}'],
    ['{for @x of [1]}{@__proto__}{/for}'],
    ['{for @__proto__ of [1]}x{/for}'],
    ['{for @i, @__proto__ of [1]}x{/for}'],
    ['{widget "w" @__proto__}x{/widget}'],
    ['{computed $__proto__ = 1}'],
    ['{computed @__proto__ = 1}'],
    ['{unset $__proto__}'],
    ['{unset @__proto__}'],
    ['{textbox "$__proto__"}'],
    ['{checkbox "$__proto__" "label"}'],
  ])('is refused with an error: %s', (markup) => {
    expect(errorOf(markup)).toMatch(/__proto__/);
    expect(Object.getPrototypeOf(state().variables)).toBe(null);
    expect(Object.getPrototypeOf(state().temporary)).toBe(null);
    expect(Object.getPrototypeOf(state().transient)).toBe(null);
    expect(Object.keys(state().variables)).toEqual([]);
  });
});

describe('in attribute values, alt text and labels', () => {
  const titleOf = (el: HTMLElement) =>
    el.querySelector('span:not(.error)')?.getAttribute('title');

  it('read unset inherited names as empty', () => {
    const el = renderMarkup(
      '{for @x of [1]}<span title="[{$toString}{_constructor}{%valueOf}{@hasOwnProperty}{print $isPrototypeOf}]">s</span>{/for}',
    );
    expect(titleOf(el)).toBe('[]');
    expect(el.querySelector('.error')).toBeNull();
  });

  it('read unset inherited names as empty in code attributes', () => {
    const el = renderMarkup(
      '<span onclick="f([{$toString}{_valueOf}{%constructor}])">s</span>',
    );
    expect(el.querySelector('span')!.getAttribute('onclick')).toBe('f([])');
  });

  it('read unset inherited names as empty in alt text and labels', () => {
    const el = renderMarkup(
      '![a{$toString}b](x.png) {button "c{$valueOf}d"}{/button}',
    );
    expect(el.querySelector('img')!.getAttribute('alt')).toBe('ab');
    expect(el.querySelector('button')!.textContent).toBe('cd');
  });

  it('display variables named like Object.prototype members', () => {
    act(() => {
      window.Story.set('toString', 'T');
      window.Story.set('%constructor', 'C');
    });
    const el = renderMarkup(
      '<span title="{$toString}{%constructor}{print $toString}">s</span>',
    );
    expect(titleOf(el)).toBe('TCT');
  });

  it('give {for} text form and widget locals inherited names', () => {
    renderMarkup('{widget "w" @constructor}<{@constructor}>{/widget}');
    const el = renderMarkup(
      "<span title=\"{for @valueOf, @toString of ['a', 'b']}{@toString}{@valueOf}{/for}|{w 7}|{w}\">s</span>",
    );
    expect(titleOf(el)).toBe('0a1b|<7>|<>');
  });

  it.each([
    ['<span title="{$__proto__}">s</span>'],
    ['<span title="{___proto__}">s</span>'],
    ['<span title="{%__proto__.x}">s</span>'],
    ['{for @x of [1]}<span title="{@__proto__}">s</span>{/for}'],
    ['<span title="{print $__proto__}">s</span>'],
    ['<span title="{for @__proto__ of [1]}x{/for}">s</span>'],
    ['<span title="{for @i, @__proto__ of [1]}x{/for}">s</span>'],
    ['<span onclick="f({$__proto__})">s</span>'],
    ['<span onclick="f({$__proto__ + 1})">s</span>'],
    ['![{$__proto__}](x.png)'],
  ])('refuse a variable named __proto__ with an error: %s', (markup) => {
    const el = renderMarkup(markup);
    expect(el.querySelector('.error')?.textContent ?? '').toMatch(
      /__proto__" cannot be used as a variable name/,
    );
    expect(Object.getPrototypeOf(state().variables)).toBe(null);
    expect(Object.keys(state().variables)).toEqual([]);
  });

  it('give a text form the locals it adds as variables, refusing __proto__', () => {
    defineMacro({
      name: 'withlocal',
      block: true,
      render: () => null,
      text: ({ rawArgs, children = [] }, ctx) =>
        ctx.renderText(children, { [rawArgs.trim()]: 'L' }),
    });
    const el = renderMarkup(
      '<span title="{withlocal toString}[{@toString}]{/withlocal}">s</span>',
    );
    expect(titleOf(el)).toBe('[L]');
    const refused = renderMarkup(
      '<span title="{withlocal __proto__}[{@x}]{/withlocal}">s</span>',
    );
    expect(titleOf(refused)).toBe('');
    expect(refused.querySelector('.error')?.textContent).toMatch(
      /withlocal error.*"@__proto__" cannot be used as a variable name/,
    );
  });

  it('refuse a variable named __proto__ in a label, logging the error', () => {
    const error = vi.mocked(console.error);
    const el = renderMarkup('{button "a{$__proto__}b"}{/button}');
    expect(el.querySelector('button')!.textContent).toBe('ab');
    expect(String(error.mock.calls[0]?.[0])).toMatch(/__proto__/);
  });
});
