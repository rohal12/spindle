// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import {
  registerWidget,
  clearWidgets,
} from '../../src/widgets/widget-registry';
import { parseMarkup } from '../../src/markup/parse';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function setup(vars: Record<string, unknown>, extra: PassageData[] = []): void {
  const passages = [makePassage(1, 'Start', 'Start'), ...extra];
  const data: StoryData = {
    name: 'Test',
    startNode: 1,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
  useStoryStore.getState().init(data, vars);
  installStoryAPI();
}

function renderPassage(content: string): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  return container;
}

describe('summaries and legends produced by macros (#474)', () => {
  beforeEach(() => {
    clearWidgets();
    setup({ show: true }, [
      makePassage(2, 'Label', '<summary id="label">Read hint</summary>'),
    ]);
  });

  const expectDirectSummary = (el: HTMLElement) => {
    const summary = el.querySelector('#hint > summary#label');
    expect(summary).not.toBeNull();
    expect(summary!.querySelector('p')).toBeNull();
    expect(el.querySelector('#hint > p')?.textContent).toContain('clue');
  };

  it('keeps a summary rendered by {if} a direct child of details', () => {
    const el = renderPassage(
      '<details id="hint">\n{if $show}<summary id="label">Read hint</summary>{/if}\nSecret **clue**\n</details>',
    );
    expectDirectSummary(el);
    expect(el.querySelector('#hint strong')!.textContent).toBe('clue');
  });

  it('keeps a summary rendered by {include} a direct child of details', () => {
    const el = renderPassage(
      '<details id="hint">{include "Label"}\nSecret clue\n</details>',
    );
    expectDirectSummary(el);
  });

  it('keeps a summary rendered by a widget a direct child of details', () => {
    registerWidget(
      'Label',
      parseMarkup('<summary id="label">Read hint</summary>'),
      [],
      false,
    );
    const el = renderPassage(
      '<details id="hint">{Label}\nSecret clue\n</details>',
    );
    expectDirectSummary(el);
  });

  it('keeps a legend rendered by a macro a direct child of fieldset', () => {
    const el = renderPassage(
      '<fieldset id="group" disabled>{if $show}<legend id="l">Custom <input type="checkbox" id="enable"></legend>{/if}\nChoose below.\n<input id="setting"></fieldset>',
    );
    expect(el.querySelector('#group > legend#l')).not.toBeNull();
    expect(el.querySelector('#enable')!.closest('fieldset > legend')).not.toBe(
      null,
    );
  });
});

describe('fieldset legends (#475)', () => {
  beforeEach(() => setup({}));

  it('keeps the legend a direct child of its fieldset beside text', () => {
    const el = renderPassage(
      '<fieldset id="group" disabled>\n<legend id="l">Custom settings <input type="checkbox" id="enable"></legend>\nChoose your **settings** below.\n<input id="setting">\n</fieldset>',
    );
    const legend = el.querySelector('#group > legend');
    expect(legend).not.toBeNull();
    expect(legend!.contains(el.querySelector('#enable'))).toBe(true);
    expect(el.querySelector('#group > p')).not.toBeNull();
    expect(el.querySelector('#group strong')!.textContent).toBe('settings');
    expect(el.querySelector('#group p legend')).toBeNull();
  });

  it('keeps a legend a direct child with nothing before it', () => {
    const el = renderPassage(
      '<fieldset id="group"><legend>Name</legend>Body text</fieldset>',
    );
    expect(el.querySelector('#group > legend')!.textContent).toBe('Name');
  });
});

describe('HTML inside foreignObject (#477)', () => {
  beforeEach(() => {
    clearWidgets();
    setup({}, [makePassage(2, 'Card', '**Bold** and [site](https://e.com)')]);
  });

  const svg = (inner: string) =>
    `<svg width="400" height="200"><foreignObject width="400" height="200">${inner}</foreignObject></svg>`;

  it('renders Markdown and links in the HTML inside it', () => {
    const el = renderPassage(
      svg('<div id="foreign">**Bold** and [site](https://example.com)</div>'),
    );
    const div = el.querySelector('#foreign')!;
    expect(div.querySelector('strong')!.textContent).toBe('Bold');
    expect(div.querySelector('a')!.getAttribute('href')).toBe(
      'https://example.com',
    );
  });

  it('renders Markdown in the content of {include} inside it', () => {
    const el = renderPassage(svg('<div id="foreign">{include "Card"}</div>'));
    expect(el.querySelector('#foreign strong')!.textContent).toBe('Bold');
    expect(el.querySelector('#foreign a')).not.toBeNull();
  });

  it('renders Markdown in the body of a macro inside it', () => {
    const el = renderPassage(
      svg('<div id="foreign">{if true}**Bold** text{/if}</div>'),
    );
    expect(el.querySelector('#foreign strong')!.textContent).toBe('Bold');
  });

  it('keeps SVG text raw, before and after the foreignObject', () => {
    const el = renderPassage(
      '<svg width="400" height="200"><text id="before">**raw**</text><foreignObject><div>x</div></foreignObject><text id="after">**raw**</text></svg>',
    );
    for (const id of ['#before', '#after']) {
      expect(el.querySelector(id)!.textContent).toBe('**raw**');
      expect(el.querySelector(`${id} strong`)).toBeNull();
    }
  });

  it('keeps preformatted HTML inside it literal', () => {
    const el = renderPassage(svg('<pre id="pre">**raw**</pre>'));
    expect(el.querySelector('#pre')!.textContent).toBe('**raw**');
    expect(el.querySelector('#pre strong')).toBeNull();
  });

  it('keeps a nested SVG inside it raw', () => {
    const el = renderPassage(
      svg(
        '<div id="foreign">**Bold**<svg><text id="inner">**raw**</text></svg></div>',
      ),
    );
    expect(
      el.querySelector('#foreign > strong, #foreign p > strong'),
    ).not.toBeNull();
    expect(el.querySelector('#inner')!.textContent).toBe('**raw**');
  });
});
