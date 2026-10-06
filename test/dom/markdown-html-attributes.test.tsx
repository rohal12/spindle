// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';

/**
 * Raw HTML the passage tokenizer doesn't take as a tag (here: an attribute
 * name like `a.b`, which CommonMark accepts) reaches the page through
 * micromark's output. Its attributes mean what author HTML's mean (see
 * html-attribute-markup.test.tsx), instead of being Preact props.
 */
describe('attributes of HTML in markdown output', () => {
  beforeEach(() => {
    useStoryStore.setState({ variables: { x: 'X' }, temporary: {} });
  });

  function renderMarkup(markup: string): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(<>{renderNodes(buildAST(tokenize(markup)))}</>, container);
    });
    return container;
  }

  it('sets an inline event handler as an attribute instead of throwing', () => {
    const el = renderMarkup('**b** <span a.b onclick="window.clicked = 1">t');
    const span = el.querySelector('span')!;
    expect(span.getAttribute('onclick')).toBe('window.clicked = 1');
  });

  it('keeps an empty class, which preact/compat drops as a prop', () => {
    const el = renderMarkup('**b** <span a.b class="">t');
    expect(el.querySelector('span')!.hasAttribute('class')).toBe(true);
  });

  it('sets an event handler next to an attribute with a variable', () => {
    const el = renderMarkup(
      '**b** <span a.b title="{$x}" onclick="window.clicked = 1">t',
    );
    const span = el.querySelector('span[title]')!;
    expect(span.getAttribute('title')).toBe('X');
    expect(span.getAttribute('onclick')).toBe('window.clicked = 1');
  });
});
