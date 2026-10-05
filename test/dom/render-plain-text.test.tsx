// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { markdownToHtml } from '../../src/markup/markdown';
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

function renderMarkup(
  markup: string,
  options?: { nobr?: boolean },
): HTMLElement {
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  const container = document.createElement('div');
  render(<>{renderNodes(ast, options)}</>, container);
  return container;
}

describe('plain text fast path (issue #145)', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  describe('correctly renders plain text without markdown pipeline', () => {
    it('plain text in nobr mode', () => {
      const el = renderMarkup('Hello World', { nobr: true });
      expect(el.textContent).toBe('Hello World');
    });

    it('plain text with variable placeholder', () => {
      useStoryStore.getState().setVariable('name', 'ALMA');
      const el = renderMarkup('Name: {$name}', { nobr: true });
      expect(el.textContent).toBe('Name: ALMA');
    });

    it('Unicode symbols (not markdown syntax)', () => {
      const el = renderMarkup('▸ Menu ✕ Close', { nobr: true });
      expect(el.textContent).toBe('▸ Menu ✕ Close');
    });

    it('emoji content', () => {
      const el = renderMarkup('🔒 Locked', { nobr: true });
      expect(el.textContent).toBe('🔒 Locked');
    });

    it('text with colons, commas, slashes (non-markdown punctuation)', () => {
      const el = renderMarkup('Requires: Level 2, Policy / Tier 3', {
        nobr: true,
      });
      expect(el.textContent).toBe('Requires: Level 2, Policy / Tier 3');
    });

    it('text with parentheses and equals', () => {
      const el = renderMarkup('Speed (km/h) = 100', { nobr: true });
      expect(el.textContent).toBe('Speed (km/h) = 100');
    });

    it('bare exclamation mark is not markdown', () => {
      const el = renderMarkup('Activate!', { nobr: true });
      expect(el.textContent).toBe('Activate!');
    });

    it('multiple variables interleaved with text', () => {
      useStoryStore.getState().setVariable('a', 'Alpha');
      useStoryStore.getState().setVariable('b', 'Beta');
      const el = renderMarkup('{$a} and {$b}', { nobr: true });
      expect(el.textContent).toBe('Alpha and Beta');
    });

    it('HTML element children with plain text', () => {
      const el = renderMarkup(
        '<div class="box"><span class="label">Hello</span></div>',
        { nobr: true },
      );
      expect(el.querySelector('.label')!.textContent).toBe('Hello');
    });
  });

  describe('non-nobr wraps in <p>', () => {
    it('plain text without nobr gets <p> wrapper', () => {
      const el = renderMarkup('Just some text');
      const p = el.querySelector('p');
      expect(p).not.toBeNull();
      expect(p!.textContent).toBe('Just some text');
    });

    it('plain text with variable without nobr', () => {
      useStoryStore.getState().setVariable('name', 'ALMA');
      const el = renderMarkup('Hello {$name}');
      const p = el.querySelector('p');
      expect(p).not.toBeNull();
      expect(p!.textContent).toBe('Hello ALMA');
    });
  });

  describe('falls through to markdown for syntax-bearing text', () => {
    it('emphasis with asterisks', () => {
      const el = renderMarkup('This is *important* text');
      expect(el.querySelector('em')!.textContent).toBe('important');
    });

    it('emphasis with underscores', () => {
      const el = renderMarkup('This is _emphasized_ text');
      expect(el.querySelector('em')!.textContent).toBe('emphasized');
    });

    it('inline code', () => {
      const el = renderMarkup('Use `console.log` here');
      expect(el.querySelector('code')!.textContent).toBe('console.log');
    });

    it('heading', () => {
      const el = renderMarkup('# Title');
      expect(el.querySelector('h1')!.textContent).toBe('Title');
    });

    it('link syntax', () => {
      const el = renderMarkup('See [docs](http://example.com)');
      const link = el.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('docs');
    });

    it('GFM strikethrough', () => {
      const el = renderMarkup('This is ~~deleted~~ text');
      expect(el.querySelector('del')!.textContent).toBe('deleted');
    });

    it('backslash escape', () => {
      const el = renderMarkup('Price\\: free');
      expect(el.textContent).toContain('Price');
    });

    it('unordered list item', () => {
      const el = renderMarkup('- Item 1\n- Item 2');
      expect(el.querySelector('ul')).not.toBeNull();
    });

    it('ordered list item', () => {
      const el = renderMarkup('1. First\n2. Second');
      expect(el.querySelector('ol')).not.toBeNull();
    });

    it('image syntax', () => {
      const el = renderMarkup('![alt](http://example.com/img.png)');
      expect(el.querySelector('img')).not.toBeNull();
    });

    it('blockquote', () => {
      const el = renderMarkup('> quoted text');
      expect(el.querySelector('blockquote')).not.toBeNull();
    });

    it('GFM table', () => {
      const el = renderMarkup('| A | B |\n| --- | --- |\n| 1 | 2 |');
      expect(el.querySelector('table')).not.toBeNull();
    });

    it('blank lines create paragraphs', () => {
      const el = renderMarkup('Para 1\n\nPara 2');
      expect(el.querySelectorAll('p').length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('plain text fast path matches micromark (issue #171)', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  /** Render plain text straight through micromark, for comparison. */
  function micromarkHtml(text: string): string {
    const el = document.createElement('div');
    el.innerHTML = markdownToHtml(text).trim();
    return el.innerHTML;
  }

  const cases = [
    'Fish &amp; Chips',
    'A&nbsp;B',
    '&copy; 2024',
    'Snowman &#9731; here',
    'Smile &#x1F600; now',
    'Smile &#X1f600; now',
    'first  \nsecond',
    'first   \nsecond',
    'Fish & Chips',
    'AT&T and R&D',
    'a &unknown thing',
    'first\nsecond',
    // Found by property testing: `)` ordered list markers were missed.
    '2) ',
    '1) first item',
  ];

  for (const text of cases) {
    it(`renders ${JSON.stringify(text)} like micromark`, () => {
      expect(renderMarkup(text).innerHTML).toBe(micromarkHtml(text));
    });
  }

  it('decodes a named entity', () => {
    const el = renderMarkup('Fish &amp; Chips', { nobr: true });
    expect(el.textContent).toBe('Fish & Chips');
  });

  it('decodes numeric entities', () => {
    const el = renderMarkup('&#65;&#x42;C', { nobr: true });
    expect(el.textContent).toBe('ABC');
  });

  it('turns two trailing spaces into a hard break', () => {
    const el = renderMarkup('first  \nsecond');
    const p = el.querySelector('p')!;
    expect(p.querySelector('br')).not.toBeNull();
    expect(p.textContent).toBe('first\nsecond');
  });

  it('decodes entities next to a variable placeholder', () => {
    useStoryStore.getState().setVariable('dish', 'Chips');
    const el = renderMarkup('Fish &amp; {$dish}', { nobr: true });
    expect(el.textContent).toBe('Fish & Chips');
  });

  it('keeps a hard break between variable placeholders', () => {
    useStoryStore.getState().setVariable('a', 'Alpha');
    useStoryStore.getState().setVariable('b', 'Beta');
    const el = renderMarkup('A: {$a}  \nB: {$b}');
    const p = el.querySelector('p')!;
    expect(p.querySelector('br')).not.toBeNull();
    expect(p.textContent).toBe('A: Alpha\nB: Beta');
  });

  it('keeps a hard break before a macro', () => {
    const el = renderMarkup('Line one  \n{print 1 + 1}');
    const p = el.querySelector('p')!;
    expect(p.querySelector('br')).not.toBeNull();
    expect(p.textContent).toBe('Line one\n2');
  });
});

// Found by property testing: whitespace at the edges of text depended on
// whether the text took the fast path or went through micromark.
describe('whitespace at paragraph edges', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(makeStoryData([makePassage(1, 'Start', 'Start')]));
    store.setVariable('hp', 7);
  });

  it.each([' a', 'a ', '\ta', 'a \n b', ' a\t\nb '])(
    'strips paragraph whitespace like micromark: %j',
    (text) => {
      const ref = document.createElement('div');
      ref.innerHTML = markdownToHtml(text).trim();
      expect(renderMarkup(text).innerHTML).toBe(ref.innerHTML);
    },
  );

  it('keeps edge whitespace inside an inline element with markdown', () => {
    const el = renderMarkup('<span>*HP*: </span>{$hp}');
    expect(el.textContent).toBe('HP: 7');
    expect(el.querySelector('span')!.innerHTML).toBe('<em>HP</em>: ');
  });

  it('keeps edge whitespace inside an inline element without markdown', () => {
    expect(renderMarkup('<span>HP: </span>{$hp}').textContent).toBe('HP: 7');
  });

  it('keeps edge whitespace in a nobr body with markdown', () => {
    expect(renderMarkup('a {nobr}*b* {/nobr}c').textContent).toBe('a b c');
    expect(renderMarkup('a {nobr}b {/nobr}c').textContent).toBe('a b c');
  });
});
