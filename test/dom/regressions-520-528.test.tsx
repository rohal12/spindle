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
