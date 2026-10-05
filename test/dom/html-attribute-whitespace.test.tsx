// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

// Issue #219: HTML allows whitespace before and after the `=` of an
// attribute. Such tags must render as elements, not as text.

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
  act(() => {
    render(<>{renderNodes(buildAST(tokenize(markup)))}</>, container);
  });
  return container;
}

describe('whitespace around HTML attribute equals (#219)', () => {
  beforeEach(() => {
    useStoryStore.getState().init(makeStoryData());
    useStoryStore.getState().setVariable('name', 'Hero');
  });

  it('renders a paired element with spaced equals', () => {
    const el = renderMarkup('<div id = "attrs">{$name}</div>');
    expect(el.querySelector('.error')).toBeNull();
    const div = el.querySelector('#attrs');
    expect(div).not.toBeNull();
    expect(div!.textContent).toBe('Hero');
    expect(el.textContent).not.toContain('id =');
  });

  it.each([['<input value= "a">'], ['<input value ="a">']])(
    'renders a void element: %s',
    (markup) => {
      const el = renderMarkup(markup);
      const input = el.querySelector('input');
      expect(input).not.toBeNull();
      expect(input!.value).toBe('a');
      expect(el.textContent).toBe('');
    },
  );

  it('interpolates spaced attribute values reactively', () => {
    const el = renderMarkup(
      '<span class = "who-{$name}" title = {$name}>x</span>',
    );
    const span = el.querySelector('span');
    expect(span!.className).toBe('who-Hero');
    expect(span!.getAttribute('title')).toBe('Hero');
    act(() => {
      useStoryStore.getState().setVariable('name', 'Ann');
    });
    expect(span!.className).toBe('who-Ann');
    expect(span!.getAttribute('title')).toBe('Ann');
  });
});

// Found by property testing: attribute values kept character references
// literally, so title="Tom &amp; Jerry" showed "&amp;".
describe('character references in attribute values', () => {
  beforeEach(() => {
    useStoryStore.getState().init(makeStoryData());
    useStoryStore.getState().setVariable('name', 'A&amp;B');
  });

  it.each([
    ['<span title="Tom &amp; Jerry">x</span>', 'Tom & Jerry'],
    ['<span title="&lt;&#65;&#x42;&gt; &copy;">x</span>', '<AB> ©'],
    ["<span title='say &quot;hi&quot;'>x</span>", 'say "hi"'],
    ['<span title=a&amp;b>x</span>', 'a&b'],
    ['<span title="AT&T">x</span>', 'AT&T'],
  ])('decodes %s', (markup, title) => {
    const el = renderMarkup(markup);
    expect(el.querySelector('span')!.getAttribute('title')).toBe(title);
  });

  it('decodes around an interpolation but not inside its value', () => {
    const el = renderMarkup('<span title="&lt;{$name}&gt;">x</span>');
    expect(el.querySelector('span')!.getAttribute('title')).toBe('<A&amp;B>');
  });

  it('keeps a brace from a reference literal', () => {
    const el = renderMarkup('<span title="&#123;$name} &amp;">x</span>');
    expect(el.querySelector('span')!.getAttribute('title')).toBe('{$name} &');
  });
});
