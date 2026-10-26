// @vitest-environment happy-dom
import { expect, it } from 'vitest';
import { render } from 'preact';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import type { ASTNode } from '../../src/markup/ast';
import { expectAboutLinear, LINEAR_TIMEOUT } from '../support/linear-time';

it.each([false, true])(
  'converts wide Markdown without argument spreading (nobr=%s, #681)',
  (nobr) => {
    const nodes = parseMarkup('*a* '.repeat(2000));
    expect(() => renderNodes(nodes, { nobr })).not.toThrow();
  },
  30_000,
);

it.each([false, true])(
  'assembles wide placeholder paragraphs (nobr=%s, #681)',
  (nobr) => {
    const nodes = parseMarkup('A' + '<br>'.repeat(150_000));
    expect(() => renderNodes(nodes, { nobr })).not.toThrow();
  },
  30_000,
);

it(
  'assembles many placeholders in about linear time (#683)',
  () => {
    const small = parseMarkup('A' + '<br>'.repeat(2500));
    const large = parseMarkup('A' + '<br>'.repeat(20_000));
    expectAboutLinear(
      () => {
        renderNodes(small);
      },
      () => {
        renderNodes(large);
      },
      { rounds: 5 },
    );
  },
  LINEAR_TIMEOUT,
);

it('keeps the escape guard across empty text nodes and adjacent placeholders (#683)', () => {
  const nodes: ASTNode[] = [
    { type: 'text', value: 'A\\' },
    { type: 'text', value: '' },
    ...parseMarkup('<b>B</b><i>C</i>'),
  ];
  const container = document.createElement('div');
  try {
    render(<>{renderNodes(nodes)}</>, container);
    expect(container.textContent).toBe('A\\BC');
    expect(container.querySelector('b')?.textContent).toBe('B');
    expect(container.querySelector('i')?.textContent).toBe('C');
    expect(container.innerHTML).not.toContain('data-tw=');
  } finally {
    render(null, container);
  }
});
