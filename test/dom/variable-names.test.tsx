// @vitest-environment happy-dom
/**
 * Passages using variable names that are Object.prototype members, and the
 * error for a variable named `__proto__` (see test/unit/variable-names).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { clearWidgets } from '../../src/widgets/widget-registry';
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
    render(<>{renderNodes(buildAST(tokenize(markup)))}</>, container);
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
