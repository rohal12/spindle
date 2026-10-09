// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { render } from 'preact';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';

function renderMarkup(markup: string): HTMLElement {
  const container = document.createElement('div');
  render(<>{renderNodes(parseMarkup(markup))}</>, container);
  return container;
}

describe('structural HTML containers (#423)', () => {
  it('keeps table rows separated by blank lines direct children of the section', () => {
    const el = renderMarkup(
      '<table id="t"><tbody><tr><td>Long description here</td><td>A</td></tr>\n\n<tr><td>X</td><td>B</td></tr></tbody></table>',
    );
    const tbody = el.querySelector('tbody')!;
    expect(tbody.querySelector('p > tr')).toBeNull();
    expect(Array.from(tbody.children).map((c) => c.localName)).toEqual([
      'tr',
      'tr',
    ]);
  });

  it('keeps list items separated by blank lines direct children of the list', () => {
    const el = renderMarkup('<ul><li>a</li>\n\n<li>b</li></ul>');
    expect(
      Array.from(el.querySelector('ul')!.children).map((c) => c.localName),
    ).toEqual(['li', 'li']);
  });

  it('still renders markdown inside cells', () => {
    const el = renderMarkup('<table><tr><td>**bold**</td></tr></table>');
    expect(el.querySelector('td strong')?.textContent).toBe('bold');
  });
});
