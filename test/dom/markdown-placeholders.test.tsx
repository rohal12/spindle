// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

// renderNodes() stands in a <span data-tw> placeholder for every non-text
// node while markdown runs. Markdown syntax around a placeholder must never
// break it apart or leak it as text.

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
  return container.querySelector('.passage')!;
}

function expectNoLeak(el: HTMLElement) {
  expect(el.textContent).not.toContain('data-tw');
  expect(el.textContent).not.toContain('\uE000');
}

beforeEach(() => {
  useStoryStore
    .getState()
    .init(
      makeStoryData([makePassage(1, 'Start', 'Start')]),
      { x: 'V', dir: 'D' },
      {},
    );
});

describe('backslash before a placeholder', () => {
  it('keeps a single backslash before a link literal', () => {
    const el = renderPassage('C:\\[[Start]]');
    expectNoLeak(el);
    expect(el.querySelector('a.macro-link')!.textContent).toBe('Start');
    expect(el.textContent).toBe('C:\\Start');
  });

  it('keeps a single backslash before an HTML element literal', () => {
    const el = renderPassage('C:\\<b>bold</b>');
    expectNoLeak(el);
    expect(el.querySelector('p')!.innerHTML).toBe('C:\\<b>bold</b>');
  });

  it('handles odd and even backslash runs before a placeholder', () => {
    // Markdown turns each \\ pair into one backslash; a lone trailing
    // backslash stays literal because it escapes nothing of the author's.
    expect(renderPassage('a\\\\[[Start]]').textContent).toBe('a\\Start');
    const odd = renderPassage('a\\\\\\[[Start]]');
    expectNoLeak(odd);
    expect(odd.textContent).toBe('a\\\\Start');
    expect(odd.querySelector('a.macro-link')).not.toBeNull();
  });

  it('keeps a backslash before a placeholder inside inline HTML', () => {
    const el = renderPassage('<span>a\\<i>b</i></span>');
    expectNoLeak(el);
    expect(el.querySelector('span')!.innerHTML).toBe('a\\<i>b</i>');
  });

  it('keeps a backslash before a placeholder in a code span', () => {
    const el = renderPassage('`a\\[[Start]]`');
    expectNoLeak(el);
    const code = el.querySelector('code')!;
    expect(code.textContent).toBe('a\\Start');
    expect(code.querySelector('a.macro-link')).not.toBeNull();
  });

  it('keeps a backslash before a placeholder in a fenced code block', () => {
    const el = renderPassage('```\na\\<b>x</b>\n```');
    expectNoLeak(el);
    expect(el.querySelector('pre > code')!.innerHTML).toBe('a\\<b>x</b>\n');
  });

  it('treats \\{ before a variable as the Twine brace escape', () => {
    // `\{` is consumed by the tokenizer, so no text node can end in a
    // backslash right before a variable or macro; `&#92;` gives a backslash.
    expect(renderPassage('C:\\{$dir}').textContent).toBe('C:{$dir}');
    expect(renderPassage('C:&#92;{$dir}').textContent).toBe('C:\\D');
  });
});

describe('markdown syntax next to a placeholder', () => {
  it.each([
    ['*{$x}*', '<p><em>V</em></p>'],
    ['_{$x}_', '<p><em>V</em></p>'],
    ['**{$x}**', '<p><strong>V</strong></p>'],
    ['~~{$x}~~', '<p><del>V</del></p>'],
    ['[{$x}](http://u)', '<p><a href="http://u">V</a></p>'],
    ['# {$x}', '<h1>V</h1>'],
    ['> {$x}', '<blockquote>\n<p>V</p>\n</blockquote>'],
    ['- {$x}', '<ul>\n<li>V</li>\n</ul>'],
    ['1. {$x}', '<ol>\n<li>V</li>\n</ol>'],
    ['{$x}\n===', '<h1>V</h1>'],
  ])('%j renders the value in place', (src, html) => {
    const el = renderPassage(src);
    expectNoLeak(el);
    expect(el.innerHTML).toBe(html);
  });
});
