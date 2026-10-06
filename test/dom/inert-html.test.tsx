// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { parseHtmlInert, renderNodes } from '../../src/markup/render';

/**
 * Inertness itself (no image fetches, inline handlers or custom element
 * constructors while parsing) needs a real browser: see
 * test/e2e/html-parsing.test.ts. happy-dom owns template content by the page
 * document and constructs custom elements in it, but loads no images and
 * runs no inline handlers either way. These check what headless runs rely on.
 */
describe('parseHtmlInert', () => {
  it('parses HTML into a fragment', () => {
    const content = parseHtmlInert('<p>a <img src="x.png"> <b>b</b></p>');
    const p = content.firstChild as Element;
    expect(content.childNodes).toHaveLength(1);
    expect(p.nodeName).toBe('P');
    expect(p.querySelector('img')?.getAttribute('src')).toBe('x.png');
    expect(p.querySelector('b')?.textContent).toBe('b');
  });
});

describe('markdown output with raw HTML', () => {
  function renderMarkup(markup: string, nobr = false): HTMLElement {
    const container = document.createElement('div');
    render(<>{renderNodes(buildAST(tokenize(markup)), { nobr })}</>, container);
    return container;
  }

  it('renders tags micromark passes through', () => {
    // `a.b` is an attribute name CommonMark accepts and the passage
    // tokenizer does not, so this tag goes through micromark's output.
    const el = renderMarkup('**b** <x-probe a.b>');
    expect(el.innerHTML).toBe(
      '<p><strong>b</strong> <x-probe a.b=""></x-probe></p>',
    );
  });

  it('unwraps top-level paragraphs with nobr, keeping nested ones', () => {
    const el = renderMarkup('*a*\n\n> *b*', true);
    expect(el.innerHTML).toBe(
      '<em>a</em>\n<blockquote>\n<p><em>b</em></p>\n</blockquote>',
    );
  });
});
