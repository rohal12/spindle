// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
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

  it('renders single newline as soft break, double newline as paragraph boundary', () => {
    // Single newline → within same <p> (CommonMark soft break)
    const single = renderMarkup('Line 1\nLine 2');
    expect(single.querySelectorAll('p')).toHaveLength(1);
    expect(single.textContent).toContain('Line 1');
    expect(single.textContent).toContain('Line 2');

    // Double newline → separate <p> elements (CommonMark paragraph break)
    const double = renderMarkup('Para 1\n\nPara 2');
    expect(double.querySelectorAll('p')).toHaveLength(2);
    expect(double.textContent).toContain('Para 1');
    expect(double.textContent).toContain('Para 2');
  });

  it('double newline between links creates separate paragraphs', () => {
    const el = renderMarkup(
      '[[Go|Start]]\n\n[[Look|Room]]\n\n[[Test|Start]]',
    );
    // Each link should be in its own <p> due to blank lines
    const paragraphs = el.querySelectorAll('p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    // All three links should render
    const links = el.querySelectorAll('a.passage-link');
    expect(links).toHaveLength(3);
  });

  it('triple newline also creates paragraph separation', () => {
    const el = renderMarkup('First\n\n\nSecond');
    const paragraphs = el.querySelectorAll('p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(el.textContent).toContain('First');
    expect(el.textContent).toContain('Second');
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

    it('health section: renders correctly with markdown text nodes', () => {
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

  describe('markdown rendering', () => {
    it('renders bold text', () => {
      const el = renderMarkup('This is **bold** text');
      const strong = el.querySelector('strong');
      expect(strong).not.toBeNull();
      expect(strong!.textContent).toBe('bold');
    });

    it('renders italic text', () => {
      const el = renderMarkup('This is *italic* text');
      const em = el.querySelector('em');
      expect(em).not.toBeNull();
      expect(em!.textContent).toBe('italic');
    });

    it('renders headers', () => {
      const el = renderMarkup('# Heading 1');
      const h1 = el.querySelector('h1');
      expect(h1).not.toBeNull();
      expect(h1!.textContent).toBe('Heading 1');
    });

    it('renders inline code', () => {
      const el = renderMarkup('Use `console.log()` here');
      const code = el.querySelector('code');
      expect(code).not.toBeNull();
      expect(code!.textContent).toBe('console.log()');
    });

    it('renders code blocks', () => {
      const el = renderMarkup('```\nconst x = 1;\n```');
      const pre = el.querySelector('pre');
      expect(pre).not.toBeNull();
      const code = pre!.querySelector('code');
      expect(code).not.toBeNull();
      expect(code!.textContent).toContain('const x = 1;');
    });

    it('renders unordered lists', () => {
      const el = renderMarkup('- Item 1\n- Item 2\n- Item 3');
      const ul = el.querySelector('ul');
      expect(ul).not.toBeNull();
      const items = ul!.querySelectorAll('li');
      expect(items).toHaveLength(3);
      expect(items[0].textContent).toBe('Item 1');
    });

    it('renders ordered lists', () => {
      const el = renderMarkup('1. First\n2. Second\n3. Third');
      const ol = el.querySelector('ol');
      expect(ol).not.toBeNull();
      const items = ol!.querySelectorAll('li');
      expect(items).toHaveLength(3);
    });

    it('renders blockquotes', () => {
      const el = renderMarkup('> This is a quote');
      const bq = el.querySelector('blockquote');
      expect(bq).not.toBeNull();
      expect(bq!.textContent).toContain('This is a quote');
    });

    it('renders horizontal rules', () => {
      const el = renderMarkup('Above\n\n---\n\nBelow');
      const hr = el.querySelector('hr');
      expect(hr).not.toBeNull();
    });

    it('renders strikethrough', () => {
      const el = renderMarkup('This is ~~deleted~~ text');
      const del = el.querySelector('del');
      expect(del).not.toBeNull();
      expect(del!.textContent).toBe('deleted');
    });

    it('renders GFM tables', () => {
      const el = renderMarkup(
        '| Name | Value |\n| --- | --- |\n| HP | 100 |',
      );
      const table = el.querySelector('table');
      expect(table).not.toBeNull();
      const th = table!.querySelectorAll('th');
      expect(th).toHaveLength(2);
      expect(th[0].textContent).toBe('Name');
      const td = table!.querySelectorAll('td');
      expect(td).toHaveLength(2);
      expect(td[1].textContent).toBe('100');
    });

    it('renders GFM tables with Twine variables in cells', () => {
      useStoryStore.getState().setVariable('hp', 100);
      useStoryStore.getState().setVariable('mp', 50);
      const el = renderMarkup(
        '| Stat | Value |\n| --- | --- |\n| HP | {$hp} |\n| MP | {$mp} |',
      );
      const table = el.querySelector('table');
      expect(table).not.toBeNull();
      const td = table!.querySelectorAll('td');
      expect(td).toHaveLength(4);
      expect(td[0].textContent).toBe('HP');
      expect(td[1].textContent?.trim()).toBe('100');
      expect(td[2].textContent).toBe('MP');
      expect(td[3].textContent?.trim()).toBe('50');
    });
  });

  describe('computed macro', () => {
    it('reactively updates when dependencies change', async () => {
      useStoryStore.getState().setVariable('base', 10);
      useStoryStore.getState().setVariable('bonus', 5);

      const container = document.createElement('div');
      const markup = '{computed $total = $base + $bonus}{$total}';
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      act(() => {
        render(<>{renderNodes(ast)}</>, container);
      });

      // Initial computed value
      expect(container.textContent).toBe('15');

      // Change a dependency
      act(() => {
        useStoryStore.getState().setVariable('bonus', 20);
      });

      expect(container.textContent).toBe('30');
    });

    it('works with temporary variables', () => {
      useStoryStore.getState().setTemporary('a', 3);
      useStoryStore.getState().setTemporary('b', 7);

      const container = document.createElement('div');
      const markup = '{computed _sum = _a + _b}{_sum}';
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      act(() => {
        render(<>{renderNodes(ast)}</>, container);
      });

      expect(container.textContent).toBe('10');
    });
  });
});
