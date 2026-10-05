// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { markdownOptions } from '../../src/markup/markdown';
import { micromark } from 'micromark';
import { useStoryStore } from '../../src/store';
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

  it('does not treat 4+ space indentation as code blocks and does not collapse it', () => {
    // 4-space indented text should NOT become <pre><code> blocks
    // AND the regex should not collapse 4+ spaces to a single space
    const el = renderMarkup('normal\n\n    indented line');
    // Should NOT be treated as code blocks
    expect(el.querySelector('pre')).toBeNull();
    expect(el.querySelector('code')).toBeNull();
    // Text content should still be present
    expect(el.textContent).toContain('indented line');
  });

  describe('preformatted elements', () => {
    it('keeps <pre> content literal: indentation and markdown-like text', () => {
      const text = 'def f(a, b):\n    return a * b\n# not a heading\n  - item';
      const el = renderMarkup(`<pre>${text}</pre>`);
      const pre = el.querySelector('pre')!;
      expect(pre.textContent).toBe(text);
      expect(pre.querySelector('p, h1, ul')).toBeNull();
    });

    it('keeps nested element and variable content literal in <pre>', () => {
      useStoryStore.getState().setVariable('n', 3);
      const el = renderMarkup('<pre><b>x:</b>\n    {$n} * 2\n# end</pre>');
      const pre = el.querySelector('pre')!;
      expect(pre.textContent).toBe('x:\n    3 * 2\n# end');
      expect(pre.querySelector('p, h1, em')).toBeNull();
    });

    it('keeps macro body content literal in <pre>', () => {
      const el = renderMarkup(
        '<pre>{if true}  * not a list\n    kept{/if}\n{for @x of [1, 2]}  - {@x}\n{/for}</pre>',
      );
      const pre = el.querySelector('pre')!;
      expect(pre.textContent).toBe('  * not a list\n    kept\n  - 1\n  - 2\n');
      expect(pre.querySelector('p, ul, li')).toBeNull();
    });

    it('keeps <textarea> content literal', () => {
      const el = renderMarkup('<textarea># title\n    *indented*</textarea>');
      const textarea = el.querySelector('textarea')!;
      expect(textarea.value).toBe('# title\n    *indented*');
    });

    it('still renders markdown in a block element next to <pre>', () => {
      const el = renderMarkup('<div>**bold**</div><pre>**raw**</pre>');
      expect(el.querySelector('div strong')!.textContent).toBe('bold');
      expect(el.querySelector('pre')!.textContent).toBe('**raw**');
    });
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
    const el = renderMarkup('[[Go|Start]]\n\n[[Look|Room]]\n\n[[Test|Start]]');
    // Each link should be in its own <p> due to blank lines
    const paragraphs = el.querySelectorAll('p');
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    // All three links should render
    const links = el.querySelectorAll('a.macro-link');
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
    const link = el.querySelector('a.macro-link');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('Go');
  });

  it('renders wiki-link with apostrophe in passage name', () => {
    const store = useStoryStore.getState();
    store.init(
      makeStoryData([
        makePassage(1, 'Start', 'Start'),
        makePassage(2, "The Director's Cut", 'Content'),
      ]),
    );
    const el = renderMarkup("[[Watch it|The Director's Cut]]");
    const link = el.querySelector('a.macro-link');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe('Watch it');
  });

  it('renders wiki-link with apostrophe in display text', () => {
    const el = renderMarkup("[[It's time|Start]]");
    const link = el.querySelector('a.macro-link');
    expect(link).not.toBeNull();
    expect(link!.textContent).toBe("It's time");
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
      expect(link!.className).toBe('macro-link fancy');
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
        '{.danger button "Click"}$count = $count + 1{/button}',
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
      expect(link!.className).toBe('macro-link fancy bold');
    });

    it('sets id on passage link', () => {
      const el = renderMarkup('[[#door Go|Start]]');
      const link = el.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.id).toBe('door');
      expect(link!.className).toBe('macro-link');
    });

    it('sets id and className on passage link', () => {
      const el = renderMarkup('[[#door.fancy Go|Start]]');
      const link = el.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.id).toBe('door');
      expect(link!.className).toBe('macro-link fancy');
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
        '{#attack button "Hit"}$count = $count + 1{/button}',
      );
      const btn = el.querySelector('button');
      expect(btn).not.toBeNull();
      expect(btn!.id).toBe('attack');
    });

    it('sets id and className on button', () => {
      const el = renderMarkup(
        '{#attack.danger button "Hit"}$count = $count + 1{/button}',
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
          '  {.red button "Drink Poison"}$health -= 10{/button}\n' +
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
      expect(items[0]!.textContent).toBe('Item 1');
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
      const el = renderMarkup('| Name | Value |\n| --- | --- |\n| HP | 100 |');
      const table = el.querySelector('table');
      expect(table).not.toBeNull();
      const th = table!.querySelectorAll('th');
      expect(th).toHaveLength(2);
      expect(th[0]!.textContent).toBe('Name');
      const td = table!.querySelectorAll('td');
      expect(td).toHaveLength(2);
      expect(td[1]!.textContent).toBe('100');
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
      expect(td[0]!.textContent).toBe('HP');
      expect(td[1]!.textContent?.trim()).toBe('100');
      expect(td[2]!.textContent).toBe('MP');
      expect(td[3]!.textContent?.trim()).toBe('50');
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

    // Issue #202: Maps, Sets and RegExps all JSON.stringify to "{}"
    const mounted: HTMLElement[] = [];
    afterEach(() => {
      // Unmount so earlier {computed} macros stop reacting to the store
      for (const container of mounted.splice(0)) render(null, container);
    });

    function renderComputed(markup: string): HTMLElement {
      const container = document.createElement('div');
      mounted.push(container);
      act(() => {
        render(<>{renderNodes(buildAST(tokenize(markup)))}</>, container);
      });
      return container;
    }

    it('updates a computed Map when its contents change (#202)', () => {
      useStoryStore.getState().setVariable('n', 0);
      const el = renderComputed(
        '{computed $derived = new Map([["n", $n]])}{print $derived.get("n")}',
      );
      expect(el.textContent).toBe('0');

      act(() => {
        useStoryStore.getState().setVariable('n', 1);
      });

      const derived = useStoryStore.getState().variables.derived as Map<
        string,
        number
      >;
      expect(derived.get('n')).toBe(1);
      expect(el.textContent).toBe('1');
    });

    it('updates a computed Set when its contents change (#202)', () => {
      useStoryStore.getState().setVariable('n', 0);
      renderComputed('{computed $derived = new Set([$n])}');

      act(() => {
        useStoryStore.getState().setVariable('n', 1);
      });

      const derived = useStoryStore.getState().variables.derived as Set<number>;
      expect([...derived]).toEqual([1]);
    });

    it('updates a computed RegExp when its pattern changes (#202)', () => {
      useStoryStore.getState().setVariable('n', 'a');
      renderComputed('{computed $derived = new RegExp($n)}');

      act(() => {
        useStoryStore.getState().setVariable('n', 'b');
      });

      const derived = useStoryStore.getState().variables.derived as RegExp;
      expect(derived.source).toBe('b');
    });

    it('updates a Map nested inside a plain object and array (#202)', () => {
      useStoryStore.getState().setVariable('n', 0);
      const el = renderComputed(
        '{computed $derived = { list: [new Map([["n", $n]])] }}{print $derived.list[0].get("n")}',
      );
      expect(el.textContent).toBe('0');

      act(() => {
        useStoryStore.getState().setVariable('n', 1);
      });

      expect(el.textContent).toBe('1');
    });

    it('does not rewrite a computed Map whose contents are unchanged (#202)', () => {
      useStoryStore.getState().setVariable('n', 0);
      useStoryStore.getState().setVariable('other', 0);
      renderComputed('{computed $derived = new Map([["n", $n]])}{$other}');
      const first = useStoryStore.getState().variables.derived;

      act(() => {
        useStoryStore.getState().setVariable('other', 1);
      });

      expect(useStoryStore.getState().variables.derived).toBe(first);
    });
  });

  describe('SVG rendering', () => {
    it('creates SVG elements in the correct namespace', () => {
      const el = renderMarkup(
        '<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">' +
          '<defs>' +
          '<linearGradient id="test-grad">' +
          '<stop offset="0%" stop-color="#ff0000"/>' +
          '<stop offset="100%" stop-color="#0000ff"/>' +
          '</linearGradient>' +
          '</defs>' +
          '<line x1="10" y1="100" x2="190" y2="100" stroke="url(#test-grad)" stroke-width="4"/>' +
          '</svg>',
      );
      const svg = el.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.namespaceURI).toBe('http://www.w3.org/2000/svg');
      const grad = el.querySelector('#test-grad');
      expect(grad).not.toBeNull();
      expect(grad!.tagName).toBe('linearGradient');
    });

    it('renders multi-line SVG without escaping', () => {
      const el = renderMarkup(
        '<svg\n  width="100"\n  height="100">\n  <circle cx="50" cy="50" r="40"/>\n</svg>',
      );
      const svg = el.querySelector('svg');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('width')).toBe('100');
      const circle = el.querySelector('circle');
      expect(circle).not.toBeNull();
      expect(circle!.getAttribute('r')).toBe('40');
      // Must not contain escaped HTML
      expect(el.innerHTML).not.toContain('&lt;svg');
    });
  });

  // Issue #136: consecutive {set} macros can't see each other's temp mutations
  describe('consecutive {set} mutations (issue #136)', () => {
    it('second {set} sees temp set by first {set}', () => {
      const container = document.createElement('div');
      const tokens = tokenize(
        '{set _x = [3, 1, 2]}{set _y = _x.slice().sort()}Result: {_y}',
      );
      const ast = buildAST(tokens);
      render(<>{renderNodes(ast)}</>, container);
      expect(container.textContent).toContain('Result: 1,2,3');
    });

    it('second {set} sees $var set by first {set}', () => {
      const container = document.createElement('div');
      const tokens = tokenize('{set $a = 10}{set $b = $a + 5}Answer: {$b}');
      const ast = buildAST(tokens);
      render(<>{renderNodes(ast)}</>, container);
      expect(container.textContent).toContain('Answer: 15');
    });
  });

  describe('whitespace-only fast path (issue #143)', () => {
    it('renders HTML + macros with only whitespace text nodes', () => {
      useStoryStore.getState().setVariable('items', [
        { id: 'a', name: 'Alpha', status: 'active' },
        { id: 'b', name: 'Beta', status: 'locked' },
        { id: 'c', name: 'Gamma', status: 'active' },
      ]);

      // For-loop body is HTML + macros + variables with whitespace between tags.
      // The tokenizer produces text nodes for "\n  " indentation — these are
      // whitespace-only and should not trigger the markdown pipeline.
      const markup = [
        '{for @item of $items}',
        '  <div class="card">',
        '    <span class="name">{@item.name}</span>',
        '    {if @item.status === "active"}',
        '    <span class="badge">Active</span>',
        '    {/if}',
        '  </div>',
        '{/for}',
      ].join('\n');

      const container = document.createElement('div');
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      render(<>{renderNodes(ast)}</>, container);

      const cards = container.querySelectorAll('.card');
      expect(cards).toHaveLength(3);
      expect(cards[0]!.querySelector('.name')!.textContent).toBe('Alpha');
      expect(cards[0]!.querySelector('.badge')!.textContent).toBe('Active');
      expect(cards[1]!.querySelector('.badge')).toBeNull();
      expect(cards[2]!.querySelector('.badge')!.textContent).toBe('Active');
    });

    it('preserves markdown processing when text nodes have content', () => {
      useStoryStore
        .getState()
        .setVariable('items', [{ name: 'Alpha' }, { name: 'Beta' }]);

      // Text node "**bold** " has non-whitespace content → must go through micromark
      const markup = [
        '{for @item of $items}',
        '**{@item.name}** is ready',
        '{/for}',
      ].join('\n');

      const container = document.createElement('div');
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      render(<>{renderNodes(ast)}</>, container);

      const strongs = container.querySelectorAll('strong');
      expect(strongs).toHaveLength(2);
      expect(strongs[0]!.textContent).toBe('Alpha');
      expect(strongs[1]!.textContent).toBe('Beta');
    });

    it('uses markdown pipeline when any text node has non-whitespace content', () => {
      // Mix of whitespace text nodes (from indentation) and a real text node
      const markup = '<div class="box">\n  A **bold** label\n</div>';

      const container = document.createElement('div');
      const tokens = tokenize(markup);
      const ast = buildAST(tokens);
      render(<>{renderNodes(ast)}</>, container);

      const box = container.querySelector('.box');
      expect(box).not.toBeNull();
      const strong = box!.querySelector('strong');
      expect(strong).not.toBeNull();
      expect(strong!.textContent).toBe('bold');
    });
  });

  // Found by property testing: text with no other markdown syntax skipped
  // micromark, so a raw HTML block (a comment, processing instruction or
  // declaration opening a line) showed as text, and CR line endings kept
  // the spaces before them and made no hard breaks or paragraphs, unlike
  // the same text with any markdown in it.
  describe('text that only looks plain', () => {
    it.each([
      '<!A b',
      'x\n<?y',
      '<!-- b',
      'a <?php x ?> b',
      'a \r\nb',
      'a  \r\nb',
      'a\r\rb',
    ])('%j renders as micromark renders it', (markup) => {
      // micromark's HTML, but for comment nodes, which aren't rendered
      const expected = document.createElement('div');
      expected.innerHTML = micromark(markup, markdownOptions());
      const walker = document.createTreeWalker(
        expected,
        NodeFilter.SHOW_COMMENT,
      );
      const comments: Node[] = [];
      while (walker.nextNode()) comments.push(walker.currentNode);
      for (const comment of comments) comment.parentNode!.removeChild(comment);
      expect(renderMarkup(markup).innerHTML).toBe(expected.innerHTML);
    });

    it('makes a hard break and paragraphs at CR line endings', () => {
      expect(renderMarkup('a  \r\nb').querySelector('br')).not.toBeNull();
      expect(renderMarkup('a\r\rb').querySelectorAll('p')).toHaveLength(2);
    });
  });

  // Found by fuzzing: the whitespace trimmed at the edges of a paragraph and
  // around its line endings was found with regexes (`/[ \t]*$/`) that try
  // every position of a whitespace run, quadratic in its length.
  describe('long whitespace runs', () => {
    /** Milliseconds to render `markup`, best of three. */
    function time(markup: string): number {
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        renderMarkup(markup);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    }

    it.each([
      ['plain text', (ws: string) => `a${ws}b`],
      ['markdown', (ws: string) => `*a*${ws}b`],
      ['a variable', (ws: string) => `{$x}${ws}b`],
      ['an inline element', (ws: string) => `<span>a${ws}b</span>`],
    ])('render in about linear time in %s', (_, markup) => {
      useStoryStore.getState().setVariable('x', 'X');
      for (const unit of [' ', '\t', ' \t']) {
        const small = time(markup(unit.repeat(2000)));
        const large = time(markup(unit.repeat(16000)));
        // 8× the input may take 8× the time, not the 64× of a quadratic scan
        expect(large).toBeLessThan(Math.max(small, 1) * 24);
      }
    });

    it('keep their spaces, but not around line endings', () => {
      useStoryStore.getState().setVariable('x', 'X');
      const el = renderMarkup(`a${' '.repeat(5)}b \t\n\t c {$x}  \t`);
      expect(el.innerHTML).toBe(`<p>a${' '.repeat(5)}b\nc X</p>`);
    });
  });
});
