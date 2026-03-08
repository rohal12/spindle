// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
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
  const passage = makePassage(1, 'Test', content);
  const container = document.createElement('div');
  render(<Passage passage={passage} />, container);
  return container;
}

describe('macro components', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  describe('{set}', () => {
    it('sets a variable in the store', () => {
      renderPassage('{set $health = 100}');
      expect(useStoryStore.getState().variables.health).toBe(100);
    });

    it('sets multiple variables with separate set macros', () => {
      renderPassage('{set $a = 1}{set $b = 2}');
      const state = useStoryStore.getState();
      expect(state.variables.a).toBe(1);
      expect(state.variables.b).toBe(2);
    });
  });

  describe('{$var} display', () => {
    it('displays variable value', () => {
      useStoryStore.getState().setVariable('name', 'Hero');
      const el = renderPassage('Hello {$name}!');
      expect(el.textContent).toContain('Hero');
    });

    it('displays empty string for undefined variable', () => {
      const el = renderPassage('Value: {$missing}.');
      expect(el.textContent).toContain('Value: .');
    });
  });

  describe('{print}', () => {
    it('evaluates and displays expression', () => {
      useStoryStore.getState().setVariable('x', 5);
      const el = renderPassage('{print $x * 2}');
      expect(el.textContent).toContain('10');
    });

    it('shows error for invalid expression', () => {
      const el = renderPassage('{print $x +}');
      const error = el.querySelector('.error');
      expect(error).not.toBeNull();
    });
  });

  describe('{if}/{elseif}/{else}/{/if}', () => {
    it('renders truthy branch', () => {
      useStoryStore.getState().setVariable('x', true);
      const el = renderPassage('{if $x}yes{/if}');
      expect(el.textContent).toContain('yes');
    });

    it('hides falsy branch', () => {
      useStoryStore.getState().setVariable('x', false);
      const el = renderPassage('{if $x}yes{/if}');
      expect(el.textContent).not.toContain('yes');
    });

    it('renders else branch when condition is false', () => {
      useStoryStore.getState().setVariable('x', false);
      const el = renderPassage('{if $x}yes{else}no{/if}');
      expect(el.textContent).toContain('no');
      expect(el.textContent).not.toContain('yes');
    });

    it('renders elseif branch', () => {
      useStoryStore.getState().setVariable('x', false);
      useStoryStore.getState().setVariable('y', true);
      const el = renderPassage('{if $x}A{elseif $y}B{else}C{/if}');
      expect(el.textContent).toContain('B');
      expect(el.textContent).not.toContain('A');
      expect(el.textContent).not.toContain('C');
    });

    it('renders first truthy branch only', () => {
      useStoryStore.getState().setVariable('x', true);
      useStoryStore.getState().setVariable('y', true);
      const el = renderPassage('{if $x}A{elseif $y}B{/if}');
      expect(el.textContent).toContain('A');
      expect(el.textContent).not.toContain('B');
    });
  });

  describe('{for}', () => {
    it('iterates over an array', () => {
      useStoryStore.getState().setVariable('items', ['a', 'b', 'c']);
      const el = renderPassage('{for @item of $items}{@item} {/for}');
      expect(el.textContent).toContain('a');
      expect(el.textContent).toContain('b');
      expect(el.textContent).toContain('c');
    });

    it('provides index variable', () => {
      useStoryStore.getState().setVariable('items', ['x', 'y']);
      const el = renderPassage(
        '{for @item, @i of $items}{print @i}: {@item} {/for}',
      );
      expect(el.textContent).toContain('0');
      expect(el.textContent).toContain('x');
      expect(el.textContent).toContain('1');
      expect(el.textContent).toContain('y');
    });

    it('shows error for non-array', () => {
      useStoryStore.getState().setVariable('x', 42);
      const el = renderPassage('{for @item of $x}item{/for}');
      const error = el.querySelector('.error');
      expect(error).not.toBeNull();
    });

    it('set inside for-loop modifies store variable using @local', () => {
      useStoryStore.getState().setVariable('items', [10, 20, 30]);
      useStoryStore.getState().setVariable('total', 0);
      renderPassage('{for @item of $items}{set $total = $total + @item}{/for}');
      expect(useStoryStore.getState().variables.total).toBe(60);
    });

    it('do inside for-loop can modify store variables', () => {
      useStoryStore.getState().setVariable('names', ['a', 'b']);
      useStoryStore.getState().setVariable('result', '');
      renderPassage(
        '{for @name of $names}{do}$result = $result + @name{/do}{/for}',
      );
      expect(useStoryStore.getState().variables.result).toBe('ab');
    });

    it('button inside for-loop reads correct @local on click', () => {
      useStoryStore.getState().setVariable('items', [1, 2, 3]);
      useStoryStore.getState().setVariable('picked', 0);
      const el = renderPassage(
        '{for @item of $items}{button $picked = @item}Pick{/button}{/for}',
      );
      const buttons = el.querySelectorAll('button.macro-button');
      expect(buttons.length).toBe(3);
      // Click the second button (item=2)
      (buttons[1] as HTMLElement).click();
      expect(useStoryStore.getState().variables.picked).toBe(2);
    });

    it('nested for-loops scope @locals correctly with set', () => {
      useStoryStore.getState().setVariable('outer', ['a', 'b']);
      useStoryStore.getState().setVariable('inner', [1, 2]);
      useStoryStore.getState().setVariable('log', '');
      renderPassage(
        '{for @o of $outer}{for @i of $inner}{set $log = $log + @o + @i}{/for}{/for}',
      );
      expect(useStoryStore.getState().variables.log).toBe('a1a2b1b2');
    });
  });

  describe('{do}', () => {
    it('executes code and modifies variables', () => {
      renderPassage('{do}$score = 42{/do}');
      expect(useStoryStore.getState().variables.score).toBe(42);
    });
  });

  describe('{meter}', () => {
    it('renders .macro-meter container with fill and label', () => {
      useStoryStore.getState().setVariable('hp', 75);
      useStoryStore.getState().setVariable('maxHp', 100);
      const el = renderPassage('{meter $hp $maxHp}');
      const meter = el.querySelector('.macro-meter');
      expect(meter).not.toBeNull();
      expect(meter!.querySelector('.macro-meter-fill')).not.toBeNull();
      expect(meter!.querySelector('.macro-meter-label')).not.toBeNull();
    });

    it('fill width matches percentage', () => {
      useStoryStore.getState().setVariable('hp', 75);
      useStoryStore.getState().setVariable('maxHp', 100);
      const el = renderPassage('{meter $hp $maxHp}');
      const fill = el.querySelector('.macro-meter-fill') as HTMLElement;
      expect(fill.style.width).toBe('75%');
    });

    it('default label shows "75 / 100"', () => {
      useStoryStore.getState().setVariable('hp', 75);
      useStoryStore.getState().setVariable('maxHp', 100);
      const el = renderPassage('{meter $hp $maxHp}');
      const label = el.querySelector('.macro-meter-label');
      expect(label!.textContent).toBe('75 / 100');
    });

    it('"%" label mode shows "75%"', () => {
      useStoryStore.getState().setVariable('hp', 75);
      useStoryStore.getState().setVariable('maxHp', 100);
      const el = renderPassage('{meter $hp $maxHp "%"}');
      const label = el.querySelector('.macro-meter-label');
      expect(label!.textContent).toBe('75%');
    });

    it('"none" label mode renders no label span', () => {
      useStoryStore.getState().setVariable('hp', 75);
      useStoryStore.getState().setVariable('maxHp', 100);
      const el = renderPassage('{meter $hp $maxHp "none"}');
      const label = el.querySelector('.macro-meter-label');
      expect(label).toBeNull();
    });

    it('"HP" label mode shows "75 HP / 100 HP"', () => {
      useStoryStore.getState().setVariable('hp', 75);
      useStoryStore.getState().setVariable('maxHp', 100);
      const el = renderPassage('{meter $hp $maxHp "HP"}');
      const label = el.querySelector('.macro-meter-label');
      expect(label!.textContent).toBe('75 HP / 100 HP');
    });

    it('clamps to 0% when current < 0', () => {
      useStoryStore.getState().setVariable('hp', -10);
      useStoryStore.getState().setVariable('maxHp', 100);
      const el = renderPassage('{meter $hp $maxHp}');
      const fill = el.querySelector('.macro-meter-fill') as HTMLElement;
      expect(fill.style.width).toBe('0%');
    });

    it('clamps to 100% when current > max', () => {
      useStoryStore.getState().setVariable('hp', 150);
      useStoryStore.getState().setVariable('maxHp', 100);
      const el = renderPassage('{meter $hp $maxHp}');
      const fill = el.querySelector('.macro-meter-fill') as HTMLElement;
      expect(fill.style.width).toBe('100%');
    });

    it('supports CSS class/id selectors', () => {
      useStoryStore.getState().setVariable('hp', 50);
      const el = renderPassage('{.health-bar#hp meter $hp 100}');
      const meter = el.querySelector('.macro-meter');
      expect(meter).not.toBeNull();
      expect(meter!.classList.contains('health-bar')).toBe(true);
      expect(meter!.id).toBe('hp');
    });

    it('renders error span on invalid expression', () => {
      const el = renderPassage('{meter $hp +}');
      const error = el.querySelector('.error');
      expect(error).not.toBeNull();
    });
  });

  describe('error handling', () => {
    it('displays parse error for unclosed macro', () => {
      const el = renderPassage('{if $x}no close');
      const error = el.querySelector('.error');
      expect(error).not.toBeNull();
      expect(error!.textContent).toContain('Unclosed');
    });
  });

  describe('nested macros', () => {
    it('handles nested if blocks', () => {
      useStoryStore.getState().setVariable('a', true);
      useStoryStore.getState().setVariable('b', true);
      const el = renderPassage('{if $a}{if $b}inner{/if}{/if}');
      expect(el.textContent).toContain('inner');
    });

    it('handles macros with links', () => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Start'),
        makePassage(2, 'Next', 'Next'),
      ]);
      useStoryStore.getState().init(storyData);
      useStoryStore.getState().setVariable('show', true);

      const el = renderPassage('{if $show}[[Go|Next]]{/if}');
      const link = el.querySelector('a.macro-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Go');
    });
  });
});
