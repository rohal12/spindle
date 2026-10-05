// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

// Issue #177: present HTML boolean attributes (bare or `=""`) must turn the
// corresponding DOM property on, not off.

function makeStoryData(): StoryData {
  const p: Passage = {
    pid: 1,
    name: 'Start',
    tags: [],
    metadata: {},
    content: '',
  };
  return {
    name: 'Test',
    startNode: 1,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map([[p.name, p]]),
    passagesById: new Map([[p.pid, p]]),
    userCSS: '',
    userScript: '',
  };
}

function renderMarkup(markup: string): HTMLElement {
  const container = document.createElement('div');
  render(<>{renderNodes(buildAST(tokenize(markup)))}</>, container);
  return container;
}

describe('HTML boolean attributes (#177)', () => {
  beforeEach(() => {
    useStoryStore.getState().init(makeStoryData());
  });

  for (const syntax of ['bare', 'empty-string'] as const) {
    const attr = (name: string) => (syntax === 'bare' ? name : `${name}=""`);

    describe(`${syntax} syntax`, () => {
      it('disabled and checked on a checkbox', () => {
        const el = renderMarkup(
          `<input type="checkbox" ${attr('disabled')} ${attr('checked')}/>`,
        );
        const input = el.querySelector('input')!;
        expect(input.disabled).toBe(true);
        expect(input.checked).toBe(true);
        expect(input.hasAttribute('disabled')).toBe(true);
      });

      it('readonly, required and autofocus on a text input', () => {
        const el = renderMarkup(
          `<input type="text" ${attr('readonly')} ${attr('required')} ${attr('autofocus')}/>`,
        );
        const input = el.querySelector('input')!;
        expect(input.readOnly).toBe(true);
        expect(input.required).toBe(true);
        expect(input.hasAttribute('autofocus')).toBe(true);
      });

      it('multiple on a select and selected on an option', () => {
        const el = renderMarkup(
          `<select ${attr('multiple')}><option value="a">A</option><option value="b" ${attr('selected')}>B</option></select>`,
        );
        const select = el.querySelector('select')!;
        expect(select.multiple).toBe(true);
        expect(select.options[1]!.selected).toBe(true);
        expect(select.options[0]!.selected).toBe(false);
      });

      it('disabled on a button', () => {
        const el = renderMarkup(`<button ${attr('disabled')}>Go</button>`);
        expect(el.querySelector('button')!.disabled).toBe(true);
      });

      it('hidden on a div', () => {
        const el = renderMarkup(`<div ${attr('hidden')}>secret</div>`);
        const div = el.querySelector('div')!;
        expect(div.hidden).toBe(true);
        expect(div.hasAttribute('hidden')).toBe(true);
      });

      it('open on details', () => {
        const el = renderMarkup(
          `<details ${attr('open')}><summary>S</summary>Body</details>`,
        );
        const details = el.querySelector('details')!;
        expect(details.hasAttribute('open')).toBe(true);
      });

      it('novalidate on a form', () => {
        const el = renderMarkup(`<form ${attr('novalidate')}></form>`);
        expect(el.querySelector('form')!.hasAttribute('novalidate')).toBe(true);
      });

      it('controls, loop and muted on video', () => {
        const el = renderMarkup(
          `<video ${attr('controls')} ${attr('loop')} ${attr('muted')}></video>`,
        );
        const video = el.querySelector('video')!;
        expect(video.hasAttribute('controls')).toBe(true);
        expect(video.hasAttribute('loop')).toBe(true);
        expect(video.muted).toBe(true);
      });
    });
  }

  it('treats boolean attribute names case-insensitively', () => {
    const el = renderMarkup('<input type="checkbox" DISABLED/>');
    expect(el.querySelector('input')!.disabled).toBe(true);
  });

  it('keeps disabled="disabled" truthy', () => {
    const el = renderMarkup('<input type="checkbox" disabled="disabled"/>');
    expect(el.querySelector('input')!.disabled).toBe(true);
  });

  it('leaves an unchecked checkbox unchecked', () => {
    const el = renderMarkup('<input type="checkbox"/>');
    const input = el.querySelector('input')!;
    expect(input.checked).toBe(false);
    expect(input.disabled).toBe(false);
  });

  it('keeps empty non-boolean attributes as empty strings', () => {
    const el = renderMarkup(
      '<input type="text" value="" placeholder="" aria-label="" data-x=""/>',
    );
    const input = el.querySelector('input')!;
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder')).toBe('');
    expect(input.getAttribute('aria-label')).toBe('');
    expect(input.getAttribute('data-x')).toBe('');
  });

  it('keeps bare data-* and aria-* attributes as empty strings', () => {
    const el = renderMarkup('<div data-flag aria-hidden>x</div>');
    const div = el.querySelector('div')!;
    expect(div.getAttribute('data-flag')).toBe('');
    expect(div.getAttribute('aria-hidden')).toBe('');
  });

  it('does not reinterpret an interpolated value that resolves to empty', () => {
    useStoryStore.getState().setVariable('flag', '');
    const el = renderMarkup('<input type="checkbox" checked="{$flag}"/>');
    expect(el.querySelector('input')!.checked).toBe(false);
  });
});
