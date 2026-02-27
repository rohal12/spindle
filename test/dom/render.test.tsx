// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'react-twine',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

function renderMarkup(markup: string): HTMLElement {
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  const container = document.createElement('div');
  render(<>{renderNodes(ast)}</>, container);
  return container;
}

describe('renderNodes', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(makeStoryData([makePassage(1, 'Start', 'Start passage')]));
  });

  it('renders plain text', () => {
    const el = renderMarkup('Hello world');
    expect(el.textContent).toBe('Hello world');
  });

  it('collapses single newline to space, double newline to <br>', () => {
    // Single newline → space (source formatting only)
    const single = renderMarkup('Line 1\nLine 2');
    expect(single.querySelectorAll('br')).toHaveLength(0);
    expect(single.textContent).toBe('Line 1 Line 2');

    // Double newline → <br> (intentional paragraph break)
    const double = renderMarkup('Para 1\n\nPara 2');
    expect(double.querySelectorAll('br')).toHaveLength(1);
    expect(double.textContent).toBe('Para 1Para 2');
  });

  it('renders links as anchor elements', () => {
    const el = renderMarkup('[[Go|Start]]');
    const link = el.querySelector('a.passage-link');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('Go');
  });

  it('renders {$var} with store value', () => {
    useStoryStore.getState().setVariable('name', 'Hero');
    const el = renderMarkup('{$name}');
    expect(el.textContent).toBe('Hero');
  });

  it('renders {_temp} with temporary value', () => {
    useStoryStore.getState().setTemporary('count', 42);
    const el = renderMarkup('{_count}');
    expect(el.textContent).toBe('42');
  });

  it('renders unknown macro as error', () => {
    const el = renderMarkup('{bogus}');
    const errorSpan = el.querySelector('.error');
    expect(errorSpan).not.toBeNull();
    expect(errorSpan!.textContent).toContain('unknown macro');
  });

  describe('className support', () => {
    it('appends className to passage link', () => {
      const el = renderMarkup('[[.fancy Go|Start]]');
      const link = el.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.className).toBe('passage-link fancy');
    });

    it('wraps variable in span when className present', () => {
      useStoryStore.getState().setVariable('name', 'Hero');
      const el = renderMarkup('{.hero-name $name}');
      const span = el.querySelector('span.hero-name');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('Hero');
    });

    it('variable without className has no wrapper span', () => {
      useStoryStore.getState().setVariable('name', 'Hero');
      const el = renderMarkup('{$name}');
      expect(el.querySelector('span.hero-name')).toBeNull();
      expect(el.textContent).toBe('Hero');
    });

    it('appends className to button', () => {
      const el = renderMarkup(
        '{.danger button $count = $count + 1}Click{/button}',
      );
      const btn = el.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.className).toBe('macro-button danger');
    });

    it('wraps if output in span when className on first branch', () => {
      useStoryStore.getState().setVariable('health', 30);
      const el = renderMarkup('{.highlight if $health < 50}Hurt!{/if}');
      const span = el.querySelector('span.highlight');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('Hurt!');
    });

    it('uses per-branch className on if/elseif/else', () => {
      useStoryStore.getState().setVariable('x', 1);
      const el = renderMarkup('{.green if $x > 10}big{.red else}small{/if}');
      // x=1 so else branch wins → red
      expect(el.querySelector('span.green')).toBeNull();
      const red = el.querySelector('span.red');
      expect(red).not.toBeNull();
      expect(red!.textContent).toBe('small');
    });

    it('wraps print output in span when className present', () => {
      useStoryStore.getState().setVariable('health', 100);
      const el = renderMarkup('{.muted print $health * 2}');
      const span = el.querySelector('span.muted');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('200');
    });

    it('supports multiple classes', () => {
      const el = renderMarkup('[[.fancy.bold Go|Start]]');
      const link = el.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.className).toBe('passage-link fancy bold');
    });

    it('sets id on passage link', () => {
      const el = renderMarkup('[[#door Go|Start]]');
      const link = el.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.id).toBe('door');
      expect(link!.className).toBe('passage-link');
    });

    it('sets id and className on passage link', () => {
      const el = renderMarkup('[[#door.fancy Go|Start]]');
      const link = el.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.id).toBe('door');
      expect(link!.className).toBe('passage-link fancy');
    });

    it('wraps variable in span when id present', () => {
      useStoryStore.getState().setVariable('hp', 100);
      const el = renderMarkup('{#health $hp}');
      const span = el.querySelector('#health');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('100');
    });

    it('sets id on button', () => {
      const el = renderMarkup(
        '{#attack button $count = $count + 1}Hit{/button}',
      );
      const btn = el.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.id).toBe('attack');
    });

    it('sets id and className on button', () => {
      const el = renderMarkup(
        '{#attack.danger button $count = $count + 1}Hit{/button}',
      );
      const btn = el.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.id).toBe('attack');
      expect(btn!.className).toBe('macro-button danger');
    });

    it('wraps if output in span when id on branch', () => {
      useStoryStore.getState().setVariable('health', 30);
      const el = renderMarkup('{#status if $health < 50}Hurt!{/if}');
      const span = el.querySelector('#status');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('Hurt!');
    });

    it('wraps print output in span when id present', () => {
      useStoryStore.getState().setVariable('health', 100);
      const el = renderMarkup('{#hp print $health * 2}');
      const span = el.querySelector('#hp');
      expect(span).not.toBeNull();
      expect(span!.textContent).toBe('200');
    });

    it('health section: single newlines collapse, double newline produces one <br>', () => {
      useStoryStore.getState().setVariable('health', 100);
      const el = renderMarkup(
        'Health: {$health} —\n' +
          '{.green if $health >= 100}\n' +
          '  Full health!\n' +
          '{.red else}\n' +
          '  You died!\n' +
          '{/if}\n' +
          '\n' +
          '{if $health > 0}\n' +
          '  {.red button $health -= 10}Drink Poison{/button}\n' +
          '{/if}',
      );
      // Only one <br> from the blank line between sections
      expect(el.querySelectorAll('br')).toHaveLength(1);
      // Green span for health status
      const green = el.querySelector('span.green');
      expect(green).not.toBeNull();
      expect(green!.textContent!.trim()).toBe('Full health!');
      // Red button for poison
      const btn = el.querySelector('button.macro-button.red');
      expect(btn).not.toBeNull();
      expect(btn!.textContent).toBe('Drink Poison');
    });
  });
});
