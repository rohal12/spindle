// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

// Issue #223: variables inside markdown code spans were resolved to a plain
// string at renderNodes() time, so they never updated while the memoized
// passage stayed on screen. They must render as subscribed components.

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

function renderPassage(content: string): HTMLElement {
  const passage = makePassage(1, 'Test', content);
  const container = document.createElement('div');
  act(() => {
    render(<Passage passage={passage} />, container);
  });
  return container;
}

describe('variables inside markdown code spans (#223)', () => {
  beforeEach(() => {
    useStoryStore.getState().init(
      makeStoryData([makePassage(1, 'Start', 'Start')]),
      { x: 0 },
      {
        t: 0,
      },
    );
  });

  it('updates a story variable inside a code span', () => {
    const el = renderPassage('`{$x}` regular: {$x}');
    expect(el.textContent).toContain('0 regular: 0');
    act(() => {
      useStoryStore.getState().setVariable('x', 2);
    });
    expect(el.querySelector('code')!.textContent).toBe('2');
    expect(el.textContent).toContain('2 regular: 2');
  });

  it('updates a temporary variable inside a code span', () => {
    act(() => {
      useStoryStore.getState().setTemporary('tmp', 'a');
    });
    const el = renderPassage('`tmp={_tmp}`');
    expect(el.querySelector('code')!.textContent).toBe('tmp=a');
    act(() => {
      useStoryStore.getState().setTemporary('tmp', 'b');
    });
    expect(el.querySelector('code')!.textContent).toBe('tmp=b');
  });

  it('updates a transient variable inside a code span', () => {
    const el = renderPassage('`t={%t}`');
    expect(el.querySelector('code')!.textContent).toBe('t=0');
    act(() => {
      useStoryStore.getState().setTransient('t', 7);
    });
    expect(el.querySelector('code')!.textContent).toBe('t=7');
  });

  it('updates dot paths inside a code span', () => {
    act(() => {
      useStoryStore.getState().setVariable('hero', { name: 'Ann' });
    });
    const el = renderPassage('`{$hero.name} ({$hero.name.length})`');
    expect(el.querySelector('code')!.textContent).toBe('Ann (3)');
    act(() => {
      useStoryStore.getState().setVariable('hero', { name: 'Bea' });
    });
    expect(el.querySelector('code')!.textContent).toBe('Bea (3)');
  });

  it('updates expressions inside a code span', () => {
    const el = renderPassage('`{$x + 1}`');
    expect(el.querySelector('code')!.textContent).toBe('1');
    act(() => {
      useStoryStore.getState().setVariable('x', 4);
    });
    expect(el.querySelector('code')!.textContent).toBe('5');
  });

  it('shows markdown characters in values literally', () => {
    act(() => {
      useStoryStore.getState().setVariable('x', '*a* `b` <i>c</i>');
    });
    const el = renderPassage('`{$x}`');
    const code = el.querySelector('code')!;
    expect(code.textContent).toBe('*a* `b` <i>c</i>');
    expect(code.querySelector('em, i')).toBeNull();
  });

  it('keeps text around the code span intact', () => {
    const el = renderPassage('before `a {$x} b` after');
    const p = el.querySelector('p')!;
    expect(p.innerHTML).toBe('before <code>a 0 b</code> after');
  });
});

// Code-span detection must match micromark exactly: multi-backtick
// delimiters, unmatched runs, backslash escapes and fenced code blocks.
describe('variables in multi-backtick spans and fenced code', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'Start')]), { x: 0 }, {});
  });

  function expectNoLeak(el: HTMLElement) {
    expect(el.textContent).not.toContain('data-tw');
    expect(el.textContent).not.toContain('');
  }

  it('updates a variable in a double-backtick span', () => {
    const el = renderPassage('``{$x}``');
    expectNoLeak(el);
    expect(el.querySelector('code')!.textContent).toBe('0');
    act(() => {
      useStoryStore.getState().setVariable('x', 2);
    });
    expect(el.querySelector('code')!.textContent).toBe('2');
  });

  it('updates a variable in a triple-backtick span', () => {
    const el = renderPassage('a ```b {$x}``` c');
    expectNoLeak(el);
    expect(el.querySelector('code')!.textContent).toBe('b 0');
    act(() => {
      useStoryStore.getState().setVariable('x', 3);
    });
    expect(el.querySelector('p')!.innerHTML).toBe('a <code>b 3</code> c');
  });

  it('keeps a single-backtick pair inside a double-backtick span literal', () => {
    const el = renderPassage('`` `a` {$x} ``');
    expectNoLeak(el);
    expect(el.querySelector('code')!.textContent).toBe('`a` 0');
    act(() => {
      useStoryStore.getState().setVariable('x', 6);
    });
    expect(el.querySelector('code')!.textContent).toBe('`a` 6');
  });

  it('keeps a single backtick inside a double-backtick span literal', () => {
    const el = renderPassage('`` a ` {$x} `` and `` b ` `` {$x}');
    expectNoLeak(el);
    const codes = el.querySelectorAll('code');
    expect(codes.length).toBe(2);
    expect(codes[0]!.textContent).toBe('a ` 0');
    expect(codes[1]!.textContent).toBe('b `');
    act(() => {
      useStoryStore.getState().setVariable('x', 5);
    });
    expect(codes[0]!.textContent).toBe('a ` 5');
    expect(el.textContent).toBe('a ` 5 and b ` 5');
  });

  it('treats an unmatched backtick run as literal text', () => {
    const el = renderPassage('``a {$x} `b`');
    expectNoLeak(el);
    expect(el.querySelector('code')!.textContent).toBe('b');
    expect(el.textContent).toBe('``a 0 b');
    act(() => {
      useStoryStore.getState().setVariable('x', 1);
    });
    expect(el.textContent).toBe('``a 1 b');
  });

  it('does not open a code span at a backslash-escaped backtick', () => {
    const el = renderPassage('\\` `{$x}`');
    expectNoLeak(el);
    expect(el.querySelector('code')!.textContent).toBe('0');
    act(() => {
      useStoryStore.getState().setVariable('x', 4);
    });
    expect(el.querySelector('p')!.innerHTML).toBe('` <code>4</code>');
  });

  it('does not treat a backslash inside a code span as an escape', () => {
    const el = renderPassage('`a\\`{$x}`');
    expectNoLeak(el);
    expect(el.querySelector('code')!.textContent).toBe('a\\');
    expect(el.textContent).toBe('a\\0`');
  });

  it('updates a variable in a backtick fenced code block', () => {
    const el = renderPassage('````\nx = {$x}\n````');
    expectNoLeak(el);
    const code = el.querySelector('pre > code')!;
    expect(code.textContent).toBe('x = 0\n');
    act(() => {
      useStoryStore.getState().setVariable('x', 9);
    });
    expect(code.textContent).toBe('x = 9\n');
  });

  it('updates a variable in a tilde fenced code block', () => {
    const el = renderPassage('~~~\n{$x} and {$x + 1}\n~~~\n\nafter {$x}');
    expectNoLeak(el);
    expect(el.querySelector('pre > code')!.textContent).toBe('0 and 1\n');
    act(() => {
      useStoryStore.getState().setVariable('x', 2);
    });
    expect(el.querySelector('pre > code')!.textContent).toBe('2 and 3\n');
    expect(el.querySelector('p')!.textContent).toBe('after 2');
  });

  it('updates a variable in a fenced code block inside a blockquote', () => {
    const el = renderPassage('> ````\n> {$x}\n> ````');
    expectNoLeak(el);
    expect(el.querySelector('blockquote pre > code')!.textContent).toBe('0\n');
  });

  it('renders a variable after closed spans as a normal component', () => {
    const el = renderPassage('`a` *{$x}* `b`');
    expectNoLeak(el);
    expect(el.querySelector('em')!.textContent).toBe('0');
    expect(el.querySelectorAll('code').length).toBe(2);
  });
});
