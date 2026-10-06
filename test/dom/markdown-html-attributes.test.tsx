// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import type { ASTNode } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { parseMarkup } from '../../src/markup/parse';
import { useStoryStore } from '../../src/store';

/**
 * Raw HTML in text nodes (which passage markup never makes, since it parses
 * every tag itself, but a custom macro may hand to `ctx.renderNodes`)
 * reaches the page through micromark's output. Its attributes mean what
 * author HTML's mean (see html-attribute-markup.test.tsx), instead of being
 * Preact props.
 */
describe('attributes of HTML in markdown output', () => {
  beforeEach(() => {
    useStoryStore.setState({ variables: { x: 'X' }, temporary: {} });
  });

  const text = (value: string): ASTNode => ({ type: 'text', value });

  function renderAST(nodes: ASTNode[]): HTMLElement {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(<>{renderNodes(nodes)}</>, container);
    });
    return container;
  }

  it('sets an inline event handler as an attribute instead of throwing', () => {
    const el = renderAST([
      text('**b** <span a.b onclick="window.clicked = 1">t'),
    ]);
    const span = el.querySelector('span')!;
    expect(span.getAttribute('onclick')).toBe('window.clicked = 1');
  });

  it('keeps an empty class, which preact/compat drops as a prop', () => {
    const el = renderAST([text('**b** <span a.b class="">t')]);
    expect(el.querySelector('span')!.hasAttribute('class')).toBe(true);
  });

  it('sets an event handler next to an attribute with a variable', () => {
    const el = renderAST([
      text('**b** <span a.b title="'),
      { type: 'variable', name: 'x', scope: 'variable' },
      text('" onclick="window.clicked = 1">t'),
    ]);
    const span = el.querySelector('span[title]')!;
    expect(span.getAttribute('title')).toBe('X');
    expect(span.getAttribute('onclick')).toBe('window.clicked = 1');
  });
});

describe('attribute names HTML accepts, in passage markup', () => {
  it('sets those setAttribute rejects too', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(
        <>
          {renderNodes(parseMarkup('<span a.b a$b="1" @click="f()">t</span>'))}
        </>,
        container,
      );
    });
    const span = container.querySelector('span')!;
    expect(span.getAttribute('a.b')).toBe('');
    expect(span.getAttribute('a$b')).toBe('1');
    expect(span.getAttribute('@click')).toBe('f()');
  });
});
