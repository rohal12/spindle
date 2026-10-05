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

// Found by property testing: author attributes went through Preact (and
// preact/compat) as props, which read some names as something else.
describe('author attribute names', () => {
  beforeEach(() => {
    useStoryStore.getState().init(makeStoryData());
    useStoryStore.getState().setVariable('name', 'Hero');
  });

  it.each([
    // Preact assigned these DOM properties, where "false" counts as true
    ['<span draggable="false">x</span>', 'draggable', 'false'],
    ['<span spellcheck="false">x</span>', 'spellcheck', 'false'],
    // preact/compat removed translate="no" and an empty class
    ['<span translate="no">x</span>', 'translate', 'no'],
    ['<span class>x</span>', 'class', ''],
    // Preact consumed these props
    ['<div key="k">x</div>', 'key', 'k'],
    ['<div children="c">x</div>', 'children', 'c'],
    ['<div className="c">x</div>', 'classname', 'c'],
    // setAttribute rejects the name; the HTML parser accepts it
    ['<div @click="go()">x</div>', '@click', 'go()'],
    ['<div :value="v">x</div>', ':value', 'v'],
  ])('%s keeps the attribute as written', (markup, name, value) => {
    const el = renderMarkup(markup);
    expect(el.querySelector('.error')).toBeNull();
    expect(el.firstElementChild!.getAttribute(name)).toBe(value);
  });

  it('renders an element with a ref attribute instead of throwing', () => {
    const el = renderMarkup('<div ref="nav">x</div>');
    expect(el.querySelector('div')!.getAttribute('ref')).toBe('nav');
  });

  it('keeps an empty SVG class and an SVG className as written', () => {
    useStoryStore.getState().setVariable('c', '');
    const el = renderMarkup(
      '<svg><rect class=""/><circle className="c"/><path class="{$c}"/></svg>',
    );
    expect(el.querySelector('rect')!.getAttribute('class')).toBe('');
    expect(el.querySelector('circle')!.getAttribute('className')).toBe('c');
    expect(el.querySelector('circle')!.hasAttribute('class')).toBe(false);
    expect(el.querySelector('path')!.getAttribute('class')).toBe('');
    act(() => {
      useStoryStore.getState().setVariable('c', 'on');
    });
    expect(el.querySelector('path')!.getAttribute('class')).toBe('on');
    act(() => {
      useStoryStore.getState().setVariable('c', '');
    });
    expect(el.querySelector('path')!.getAttribute('class')).toBe('');
  });

  it('keeps inline event handler attributes instead of throwing', () => {
    const el = renderMarkup(
      '<button onclick="go()" onFocus="f()">x</button><svg><rect onclick="r()"/></svg>',
    );
    expect(el.querySelector('button')!.getAttribute('onclick')).toBe('go()');
    expect(el.querySelector('button')!.getAttribute('onfocus')).toBe('f()');
    expect(el.querySelector('rect')!.getAttribute('onclick')).toBe('r()');
  });

  it('updates directly set attributes with their variables', () => {
    const el = renderMarkup('<span onclick="say({$name})">x</span>');
    const span = el.querySelector('span')!;
    expect(span.getAttribute('onclick')).toBe('say(Hero)');
    act(() => {
      useStoryStore.getState().setVariable('name', 'Ann');
    });
    expect(span.getAttribute('onclick')).toBe('say(Ann)');
  });

  it('switches a boolean attribute with an interpolation', () => {
    useStoryStore.getState().setVariable('locked', '');
    const el = renderMarkup(
      '<button disabled="{$locked}">x</button><button disabled="false">y</button>',
    );
    const [toggled, literal] = Array.from(el.querySelectorAll('button'));
    expect(toggled!.hasAttribute('disabled')).toBe(false);
    // As in HTML, a written value means present, whatever it says.
    expect(literal!.disabled).toBe(true);
    act(() => {
      useStoryStore.getState().setVariable('locked', 'disabled');
    });
    expect(toggled!.disabled).toBe(true);
  });

  it('keeps form state as live properties', () => {
    const el = renderMarkup(
      '<input value="{$name}"><input type="checkbox" checked>',
    );
    const [text, box] = Array.from(el.querySelectorAll('input'));
    expect(text!.value).toBe('Hero');
    expect(box!.checked).toBe(true);
    act(() => {
      useStoryStore.getState().setVariable('name', 'Ann');
    });
    expect(text!.value).toBe('Ann');
  });
});
