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

describe('structural HTML containers through macro bodies (#436)', () => {
  it('keeps rows of a {for} loop with blank lines direct children of the table', () => {
    const el = renderMarkup(
      '<table id="t"><tbody>{for @item of ["A", "A long cell"]}\n\n<tr><td>{@item}</td><td>Z</td></tr>\n\n{/for}</tbody></table>',
    );
    const tbody = el.querySelector('tbody')!;
    expect(tbody.querySelector('p > tr')).toBeNull();
    expect(Array.from(tbody.children).map((c) => c.localName)).toEqual([
      'tr',
      'tr',
    ]);
    expect(el.querySelectorAll('tbody > tr > td').length).toBe(4);
  });

  it('keeps list items of an {if} branch direct children of the list', () => {
    const el = renderMarkup('<ul>{if true}\n\n<li>a</li>\n\n{/if}</ul>');
    expect(
      Array.from(el.querySelector('ul')!.children).map((c) => c.localName),
    ).toEqual(['li']);
  });

  it('still renders markdown inside cells of generated rows', () => {
    const el = renderMarkup(
      '<table><tbody>{for @i of [1]}\n\n<tr><td>**bold**</td></tr>\n\n{/for}</tbody></table>',
    );
    expect(el.querySelector('td strong')?.textContent).toBe('bold');
  });
});
