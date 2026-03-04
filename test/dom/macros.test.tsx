// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], content };
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
      const el = renderPassage('{for $item of $items}{$item} {/for}');
      expect(el.textContent).toContain('a');
      expect(el.textContent).toContain('b');
      expect(el.textContent).toContain('c');
    });

    it('provides index variable', () => {
      useStoryStore.getState().setVariable('items', ['x', 'y']);
      const el = renderPassage(
        '{for $item, $i of $items}{print $i}: {$item} {/for}',
      );
      expect(el.textContent).toContain('0');
      expect(el.textContent).toContain('x');
      expect(el.textContent).toContain('1');
      expect(el.textContent).toContain('y');
    });

    it('shows error for non-array', () => {
      useStoryStore.getState().setVariable('x', 42);
      const el = renderPassage('{for $item of $x}item{/for}');
      const error = el.querySelector('.error');
      expect(error).not.toBeNull();
    });
  });

  describe('{do}', () => {
    it('executes code and modifies variables', () => {
      renderPassage('{do}$score = 42{/do}');
      expect(useStoryStore.getState().variables.score).toBe(42);
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
      const link = el.querySelector('a.passage-link');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('Go');
    });
  });
});
