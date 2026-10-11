// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function setup(vars: Record<string, unknown> = {}) {
  const passages = [makePassage(1, 'Start', 'Start')];
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

const mounted: HTMLElement[] = [];

function renderPassage(content: string): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mounted.push(container);
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  return container;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  for (const container of mounted.splice(0)) {
    act(() => render(null, container));
    container.remove();
  }
});

describe('static value and checked are native defaults (#528)', () => {
  beforeEach(() => setup({ typed: '', flag: true, name: 'Ann' }));

  it('sets defaultValue and defaultChecked from the passage', () => {
    const el = renderPassage(
      '<input id="text" value="Guest"><input id="check" type="checkbox" checked><select id="s"><option value="a">a</option><option value="b" selected>b</option></select>',
    );
    const text = el.querySelector<HTMLInputElement>('#text')!;
    const check = el.querySelector<HTMLInputElement>('#check')!;
    expect(text.value).toBe('Guest');
    expect(text.defaultValue).toBe('Guest');
    expect(check.checked).toBe(true);
    expect(check.defaultChecked).toBe(true);
    expect(el.querySelector<HTMLSelectElement>('#s')!.value).toBe('b');
  });

  it('keeps what the reader entered when the store updates', () => {
    const el = renderPassage(
      '<input id="text" value="Guest"><input id="check" type="checkbox" checked>{$typed}',
    );
    const text = el.querySelector<HTMLInputElement>('#text')!;
    const check = el.querySelector<HTMLInputElement>('#check')!;
    // happy-dom runs no inline handlers (the e2e tests have them)
    text.addEventListener('input', () => window.Story.set('typed', text.value));
    check.addEventListener('change', () =>
      window.Story.set('flag', check.checked),
    );
    act(() => {
      text.value = 'Alice';
      text.dispatchEvent(new Event('input', { bubbles: true }));
      check.checked = false;
      check.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(window.Story.get('typed')).toBe('Alice');
    expect(window.Story.get('flag')).toBe(false);
    expect(text.value).toBe('Alice');
    expect(check.checked).toBe(false);
    expect(el.textContent).toContain('Alice');
  });

  it('keeps a static select and textarea value as a property', () => {
    const el = renderPassage(
      '<select id="s" value="b"><option value="a">a</option><option value="b">b</option></select><textarea id="t" value="hi"></textarea>',
    );
    expect(el.querySelector<HTMLSelectElement>('#s')!.value).toBe('b');
    expect(el.querySelector<HTMLTextAreaElement>('#t')!.value).toBe('hi');
  });

  it('still binds an interpolated value and checked to the variable', () => {
    const el = renderPassage(
      '<input id="text" value="{$name}"><input id="check" type="checkbox" checked="{if $flag}checked{/if}">',
    );
    const text = el.querySelector<HTMLInputElement>('#text')!;
    const check = el.querySelector<HTMLInputElement>('#check')!;
    expect(text.value).toBe('Ann');
    expect(Boolean(check.checked)).toBe(true);
    act(() => {
      window.Story.set('name', 'Bob');
      window.Story.set('flag', false);
    });
    expect(text.value).toBe('Bob');
    expect(Boolean(check.checked)).toBe(false);
  });
});

describe('{repeat} keeps the structure of its body (#520)', () => {
  beforeEach(() => setup({ count: 0 }));

  it('renders table rows as direct children of tbody', async () => {
    const el = renderPassage(`<table id="ticks">
<thead><tr><th>A long heading</th><th>Second</th></tr></thead>
<tbody>
{repeat 20ms}
{set $count += 1}
<tr><td>{$count}</td><td id="body-second">value</td></tr>
{if $count === 1}{stop}{/if}
{/repeat}
</tbody>
</table>`);
    await act(() => wait(150));
    const table = el.querySelector('#ticks')!;
    expect(table.querySelector('tbody > span')).toBeNull();
    expect(table.querySelectorAll('tbody > tr')).toHaveLength(1);
  });

  it('still remounts the body on every tick', async () => {
    const el = renderPassage(
      '{repeat 20ms}<input class="field">{if $count === 99}{stop}{/if}{/repeat}',
    );
    await act(() => wait(50));
    const first = el.querySelector('.field')!;
    expect(first).not.toBeNull();
    await act(() => wait(50));
    const later = el.querySelector('.field')!;
    expect(later).not.toBeNull();
    expect(later).not.toBe(first);
    expect(el.querySelectorAll('.field')).toHaveLength(1);
  });

  it('keeps the wrapper when the author asks for a class or id', async () => {
    const el = renderPassage(
      '{.t#ticks repeat 20ms}{set $count += 1}x{if $count === 1}{stop}{/if}{/repeat}',
    );
    await act(() => wait(100));
    expect(el.querySelector('span#ticks.t')).not.toBeNull();
  });
});
