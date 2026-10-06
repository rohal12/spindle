// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { defineMacro } from '../../src/define-macro';
import { parseMarkup } from '../../src/markup/parse';
import { registerBlockMacro } from '../../src/markup/ast';
import type { ASTNode } from '../../src/markup/ast';
import {
  registerWidget,
  clearWidgets,
} from '../../src/widgets/widget-registry';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import type { StoryData, Passage as PassageData } from '../../src/parser';

// Issue #225: attribute values accept the inline markup of passage text
// (macros, any expression), evaluated to a string and kept up to date.

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function initStory(variables: Record<string, unknown> = {}) {
  const start = makePassage(1, 'Start', 'Start');
  const storyData: StoryData = {
    name: 'Attr Story',
    startNode: 1,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map([[start.name, start]]),
    passagesById: new Map([[start.pid, start]]),
    userCSS: '',
    userScript: '',
  };
  useStoryStore.getState().init(storyData, variables);
}

const mounted: HTMLElement[] = [];

function renderPassage(content: string): HTMLElement {
  const container = document.createElement('div');
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  mounted.push(container);
  return container;
}

/** Register a widget from definition markup, mimicking boot-time logic. */
function defineWidget(markup: string): void {
  for (const node of parseMarkup(markup)) {
    if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
      const parts = node.rawArgs.trim().split(/\s+/);
      const name = parts[0]!.replace(/["']/g, '');
      const params = parts.slice(1).filter((t) => /^[$_@]/.test(t));
      const children = node.children as ASTNode[];
      const isBlock = astContainsChildren(children);
      registerWidget(name, children, params, isBlock);
      if (isBlock) registerBlockMacro(name);
    }
  }
}

function set(name: string, value: unknown) {
  act(() => window.Story.set(name, value));
}

const attr = (el: HTMLElement, selector: string, name: string) =>
  el.querySelector(selector)!.getAttribute(name);

beforeEach(() => {
  clearWidgets();
  initStory();
  installStoryAPI();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    act(() => render(null, container));
  }
});

describe('the issue #225 reproduction', () => {
  it('evaluates a conditional class, a sigil-led and a !-led expression', () => {
    const el = renderPassage(
      [
        '{set $n = 1}',
        '<span id="x" class="{if $n > 0}pos{else}neg{/if}">x</span>',
        `<span id="y" class="{$n > 0 ? 'pos' : 'neg'}">y</span>`,
        `<span id="z" class="{!$n ? 'zero' : 'nonzero'}">z</span>`,
      ].join('\n'),
    );
    expect(attr(el, '#x', 'class')).toBe('pos');
    expect(attr(el, '#y', 'class')).toBe('pos');
    expect(attr(el, '#z', 'class')).toBe('nonzero');
    expect(el.querySelector('.error')).toBeNull();
  });

  it('renders the conditional class #61 asked for', () => {
    initStory({ someVar: 'foo' });
    const el = renderPassage(
      '<div class="my-class {if $someVar == "foo"}active{/if}">d</div>',
    );
    expect(attr(el, 'div.my-class', 'class')).toBe('my-class active');
  });
});

describe('macros in attribute values', () => {
  it('picks the if / elseif / else branch, nested, keeping text around it', () => {
    initStory({ a: false, b: true, c: true });
    const el = renderPassage(
      '<span title="[{if $a}A{elseif $b}B{if $c}+C{else}-C{/if}{else}E{/if}]">s</span>',
    );
    expect(attr(el, 'span', 'title')).toBe('[B+C]');
    set('c', false);
    expect(attr(el, 'span', 'title')).toBe('[B-C]');
    set('b', false);
    expect(attr(el, 'span', 'title')).toBe('[E]');
    set('a', true);
    expect(attr(el, 'span', 'title')).toBe('[A]');
  });

  it('keeps whitespace and newlines inside branches as written', () => {
    initStory({ a: true });
    const el = renderPassage('<span title="x {if $a} y\n z {/if} w">s</span>');
    expect(attr(el, 'span', 'title')).toBe('x  y\n z  w');
  });

  it('picks the switch case or the default', () => {
    initStory({ mood: 'happy' });
    const el = renderPassage(
      '<span class="face {switch $mood}{case "happy"}smile{case "sad"}frown{default}flat{/switch}">s</span>',
    );
    expect(attr(el, 'span', 'class')).toBe('face smile');
    set('mood', 'sad');
    expect(attr(el, 'span', 'class')).toBe('face frown');
    set('mood', 'bored');
    expect(attr(el, 'span', 'class')).toBe('face flat');
  });

  it('repeats a for body with its @locals', () => {
    initStory({ list: ['a', 'b'] });
    const el = renderPassage(
      '<span data-x="{for @item, @i of $list}{@i}={@item}{if @i < $list.length - 1};{/if}{/for}">s</span>',
    );
    expect(attr(el, 'span', 'data-x')).toBe('0=a;1=b');
    set('list', ['z']);
    expect(attr(el, 'span', 'data-x')).toBe('0=z');
  });

  it('sees the @locals of an enclosing for loop', () => {
    initStory({ min: 2 });
    const el = renderPassage(
      '{for @n of [1, 2, 3]}<i class="{if @n >= $min}big{else}small{/if} n{@n}">{@n}</i>{/for}',
    );
    const classes = Array.from(el.querySelectorAll('i')).map((i) =>
      i.getAttribute('class'),
    );
    expect(classes).toEqual(['small n1', 'big n2', 'big n3']);
    set('min', 3);
    expect(
      Array.from(el.querySelectorAll('i')).map((i) => i.getAttribute('class')),
    ).toEqual(['small n1', 'small n2', 'big n3']);
  });

  it('prints with {print}, nobr and span bodies and the story title', () => {
    initStory({ a: -3 });
    const el = renderPassage(
      '<span title="{print Math.max($a, 0)}|{nobr}n{/nobr}|{span}s{/span}|{story-title}">s</span>',
    );
    expect(attr(el, 'span', 'title')).toBe('0|n|s|Attr Story');
  });

  it('evaluates a widget to the text of its body', () => {
    defineWidget(
      '{widget "badge" @kind}{if @kind == "gold"}badge-gold{else}badge-{@kind}{/if}{/widget}',
    );
    initStory({ kind: 'gold' });
    const el = renderPassage(
      '<span class="{badge $kind}">s</span><b class="{badge "tin"}">b</b>',
    );
    expect(attr(el, 'span', 'class')).toBe('badge-gold');
    expect(attr(el, 'b', 'class')).toBe('badge-tin');
    set('kind', 'iron');
    expect(attr(el, 'span', 'class')).toBe('badge-iron');
  });

  it('evaluates a block widget with {@children}', () => {
    defineWidget('{widget "wrap" @p}[{@p}:{@children}]{/widget}');
    initStory({ x: 1 });
    const el = renderPassage('<span title="{wrap "P"}c{$x}{/wrap}">s</span>');
    expect(attr(el, 'span', 'title')).toBe('[P:c1]');
    set('x', 2);
    expect(attr(el, 'span', 'title')).toBe('[P:c2]');
  });

  it('evaluates widget parameters in attributes inside the widget body', () => {
    defineWidget(
      '{widget "chip" @on}<b class="chip {if @on}on{else}off{/if}">c</b>{/widget}',
    );
    initStory({ on: true });
    const el = renderPassage('{chip $on}');
    expect(attr(el, 'b', 'class')).toBe('chip on');
    set('on', false);
    expect(attr(el, 'b', 'class')).toBe('chip off');
  });

  it('uses a custom macro text form', () => {
    defineMacro({
      name: 'shout',
      render: ({ rawArgs }, ctx) => String(ctx.evaluate!(rawArgs)),
      merged: true,
      text: ({ rawArgs }, ctx) => String(ctx.evaluate(rawArgs)).toUpperCase(),
    });
    initStory({ w: 'hey' });
    const el = renderPassage('<span title="{shout $w}">s</span>');
    expect(attr(el, 'span', 'title')).toBe('HEY');
    set('w', 'ho');
    expect(attr(el, 'span', 'title')).toBe('HO');
  });

  it('works in SVG and in live properties', () => {
    initStory({ on: true });
    const el = renderPassage(
      '<svg><rect class="{if $on}lit{/if}" viewBox="0 0 {if $on}2{else}1{/if} 1"/></svg><input value="{if $on}yes{else}no{/if}">',
    );
    expect(attr(el, 'rect', 'class')).toBe('lit');
    expect(attr(el, 'rect', 'viewBox')).toBe('0 0 2 1');
    const input = el.querySelector('input')!;
    expect(input.value).toBe('yes');
    set('on', false);
    expect(attr(el, 'rect', 'class')).toBe('');
    expect(input.value).toBe('no');
    set('on', true);
    expect(attr(el, 'rect', 'class')).toBe('lit');
  });

  it('switches a boolean attribute off when its macro yields nothing', () => {
    initStory({ locked: false });
    const el = renderPassage(
      '<button disabled="{if $locked}disabled{/if}">b</button>',
    );
    const button = el.querySelector('button')!;
    expect(button.hasAttribute('disabled')).toBe(false);
    set('locked', true);
    expect(button.disabled).toBe(true);
  });
});

describe('expressions in attribute values', () => {
  it('accepts expressions opened by a sigil, ( or !', () => {
    initStory({ a: 2, b: 3, y: 'Y', f: false });
    const el = renderPassage(
      [
        '<i id="1" title="{($a + $b)}"></i>',
        '<i id="2" title="{(Math.max($a, 10))}"></i>',
        '<i id="3" title="{("x" + $y)}"></i>',
        '<i id="4" title="{!$f}"></i>',
        '<i id="5" title="{$a * $b}"></i>',
        '<i id="6" title="{.c $a}"></i>',
      ].join(''),
    );
    const titles = Array.from(el.querySelectorAll('i')).map((i) =>
      i.getAttribute('title'),
    );
    expect(titles).toEqual(['5', '10', 'xY', 'true', '6', '2']);
    expect(el.querySelector('.error')).toBeNull();
  });

  it('displays the same expressions in passage text', () => {
    initStory({ a: 2, b: 3, f: false });
    const el = renderPassage('{($a + $b)} {!$f}');
    expect(el.textContent).toContain('5 true');
  });
});

describe('escapes and character references in attribute values', () => {
  it('escapes braces with backslashes as passage text does', () => {
    initStory({ x: 'V' });
    const el = renderPassage(
      [
        '<i id="1" title="\\{$x}"></i>',
        '<i id="2" title="C:\\\\{$x}"></i>',
        '<i id="3" title="C:\\\\\\{$x}"></i>',
        '<i id="4" title="\\{if true}a\\{/if}"></i>',
        '<i id="5" title="a\\b"></i>',
      ].join(''),
    );
    const titles = Array.from(el.querySelectorAll('i')).map((i) =>
      i.getAttribute('title'),
    );
    expect(titles).toEqual([
      '{$x}',
      'C:\\V',
      'C:\\{$x}',
      '{if true}a{/if}',
      'a\\b',
    ]);
  });

  it('decodes references in literal text, branches included, not in values', () => {
    initStory({ v: '&amp;' });
    const el = renderPassage(
      '<i title="a &amp; {if true}&lt;b{/if} {$v} &#123;$v}"></i>',
    );
    expect(attr(el, 'i', 'title')).toBe('a & <b &amp; {$v}');
  });

  it('keeps braces that open no markup as written', () => {
    const el = renderPassage(
      `<i data-json='{"a": 1}' data-n="{3}" data-s="{ x }"></i>`,
    );
    const i = el.querySelector('i')!;
    expect(i.getAttribute('data-json')).toBe('{"a": 1}');
    expect(i.getAttribute('data-n')).toBe('{3}');
    expect(i.getAttribute('data-s')).toBe('{ x }');
    expect(el.querySelector('.error')).toBeNull();
  });
});

describe('unsupported markup in attribute values', () => {
  it.each([
    ['{set $y = 1}', 'set'],
    ['{button "b"}{set $y = 1}{/button}', 'button'],
    ['{link "l" "Start"}{/link}', 'link'],
    ['{textbox "$y"}', 'textbox'],
    ['{do}$y = 1{/do}', 'do'],
    ['{goto "Start"}', 'goto'],
  ])('reports %s instead of running or printing it', (markup, name) => {
    initStory({ y: 0 });
    const el = renderPassage(
      `<span id="t" title="a{${'$'}y}${markup}b">s</span>`,
    );
    const error = el.querySelector('.error');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain(`{${name} error`);
    expect(error!.textContent).toContain('title');
    expect(attr(el, '#t', 'title')).toBe('a0b');
    expect(useStoryStore.getState().variables.y).toBe(0);
    expect(useStoryStore.getState().currentPassage).toBe('Start');
  });

  it('reports an unknown macro', () => {
    const el = renderPassage('<span id="t" class="{nope}">s</span>');
    expect(el.querySelector('.error')!.textContent).toContain('nope');
    expect(attr(el, '#t', 'class')).toBe('');
  });

  it('reports a failing expression without crashing', () => {
    initStory({ n: 1 });
    const el = renderPassage(
      '<span id="t" title="{$n + nope}|{if nope2}a{/if}|{$n}">s</span>',
    );
    const errors = Array.from(el.querySelectorAll('.error')).map(
      (e) => e.textContent,
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('nope');
    expect(errors[1]).toContain('{if error');
    expect(attr(el, '#t', 'title')).toBe('||1');
  });

  it('keeps the element mounted while an error comes and goes', () => {
    initStory({ n: 1 });
    const el = renderPassage('<b id="t" title="{$n.toFixed(1)}">b</b>');
    const b = el.querySelector('#t');
    expect(b!.getAttribute('title')).toBe('1.0');
    set('n', 'x');
    expect(el.querySelector('.error')).not.toBeNull();
    expect(el.querySelector('#t')).toBe(b);
    set('n', 2);
    expect(el.querySelector('.error')).toBeNull();
    expect(el.querySelector('#t')).toBe(b);
    expect(b!.getAttribute('title')).toBe('2.0');
  });

  it('reports unbalanced macros and keeps the value as written', () => {
    const el = renderPassage(
      '<span id="t" title="{if true}open &amp;">s</span>',
    );
    expect(el.querySelector('.error')!.textContent).toContain('Unclosed');
    expect(attr(el, '#t', 'title')).toBe('{if true}open &');
  });

  it('logs unsupported markup in a macro label to the console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const el = renderPassage('{button "a{set $y = 1}b"}{/button}');
      expect(el.querySelector('button')!.textContent).toBe('ab');
      expect(spy).toHaveBeenCalled();
      expect(String(spy.mock.calls[0])).toContain('set');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('attributes holding code', () => {
  // Event handlers hold JavaScript, `pattern` a regular expression and
  // `srcdoc` an HTML document (with its own scripts and styles): their
  // braces are code, so only sigil references are resolved, as before #225.
  it.each([
    'if (x) {return y}',
    'f({a: 1})',
    '{alert(1)}',
    '{if (a) {b()}} {for (;;) {}}',
    '{set} {nope} {/if} {(1)} {!x} {.a b}',
    '\\{x}',
  ])('keeps onclick="%s" as written, with no error', (code) => {
    const el = renderPassage(`<button id="t" onclick="${code}">b</button>`);
    expect(attr(el, '#t', 'onclick')).toBe(code);
    expect(el.querySelector('.error')).toBeNull();
  });

  it('resolves sigil references and sigil-led expressions in a handler', () => {
    initStory({ name: 'Ann', n: 1 });
    const el = renderPassage(
      `<button id="t" onClick="if (ok) {say('{$name}', {_t}, {$n + 1})}">b</button>`,
    );
    expect(attr(el, '#t', 'onclick')).toBe("if (ok) {say('Ann', , 2)}");
    set('name', 'Bo');
    expect(attr(el, '#t', 'onclick')).toBe("if (ok) {say('Bo', , 2)}");
  });

  it('sees @locals, keeps escapes and decodes references as before', () => {
    const el = renderPassage(
      '{for @i of [7]}<b id="t" ONMOUSEOVER="a &amp;&amp; g({@i}) \\{@i} &#123;@i}">b</b>{/for}',
    );
    expect(attr(el, '#t', 'onmouseover')).toBe('a && g(7) \\7 {@i}');
  });

  it('keeps pattern and srcdoc as written apart from sigil references', () => {
    initStory({ n: 3 });
    const el = renderPassage(
      `<input id="p" pattern="\\p{L}{2,{$n}}\\d{3}"><iframe id="f" srcdoc="<style>p{color:red}</style><p>{$n}</p>"></iframe>`,
    );
    expect(attr(el, '#p', 'pattern')).toBe('\\p{L}{2,3}\\d{3}');
    expect(attr(el, '#f', 'srcdoc')).toBe(
      '<style>p{color:red}</style><p>3</p>',
    );
    expect(el.querySelector('.error')).toBeNull();
  });

  it('reports a failing reference in a handler instead of crashing', () => {
    initStory({ n: 1 });
    const el = renderPassage('<b id="t" onclick="go({$n.x.y()})">b</b>');
    expect(attr(el, '#t', 'onclick')).toBe('go()');
    expect(el.querySelector('.error')!.textContent).toContain('onclick');
  });
});

describe('other text-only places', () => {
  it('evaluates macros in a macro label', () => {
    initStory({ on: true });
    const el = renderPassage('{button "{if $on}On{else}Off{/if}"}{/button}');
    expect(el.querySelector('button')!.textContent).toBe('On');
    set('on', false);
    expect(el.querySelector('button')!.textContent).toBe('Off');
  });

  it('evaluates macros in image alt text and link titles', () => {
    initStory({ on: true });
    const el = renderPassage(
      '![{if $on}lit{else}dark{/if} room](a.png "{for @i of [1, 2]}{@i}{/for}")',
    );
    const img = el.querySelector('img')!;
    expect(img.getAttribute('alt')).toBe('lit room');
    expect(img.getAttribute('title')).toBe('12');
    set('on', false);
    expect(img.getAttribute('alt')).toBe('dark room');
  });
});
