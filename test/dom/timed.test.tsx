// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

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
  document.body.appendChild(container);
  act(() => {
    render(<Passage passage={passage} />, container);
  });
  return container;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForText(
  el: HTMLElement,
  text: string,
  timeout = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (el.textContent?.includes(text)) return;
    await wait(10);
  }
  throw new Error(`Timed out waiting for "${text}" in: ${el.textContent}`);
}

describe('{timed} className and id', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const store = useStoryStore.getState();
    store.init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  it('renders nothing before the delay', () => {
    const el = renderPassage('{timed 100ms}Hello{/timed}');
    expect(el.textContent).not.toContain('Hello');
  });

  it('renders initial content after the delay', async () => {
    const el = renderPassage('{timed 50ms}Hello{/timed}');
    await waitForText(el, 'Hello');
  });

  it('applies className and id from the opening tag section', async () => {
    const el = renderPassage('{.fade#intro timed 50ms}Hello{/timed}');
    await waitForText(el, 'Hello');
    const span = el.querySelector('span.fade#intro');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('Hello');
  });

  it('applies className/id only to the section that declares them', async () => {
    const el = renderPassage(
      '{timed 50ms}Initial{.highlight#second next 50ms}Second{/timed}',
    );
    // First section has no className/id
    await waitForText(el, 'Initial');
    expect(el.querySelector('.highlight')).toBeNull();
    expect(el.querySelector('#second')).toBeNull();

    // Second section gets its own className/id
    await waitForText(el, 'Second');
    const span = el.querySelector('span.highlight#second');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('Second');
  });

  it('className from opening tag does not leak to {next} branches', async () => {
    const el = renderPassage('{.first timed 50ms}One{next 50ms}Two{/timed}');
    await waitForText(el, 'One');
    expect(el.querySelector('span.first')).not.toBeNull();

    // Second section has no className — no wrapping span
    await waitForText(el, 'Two');
    expect(el.querySelector('.first')).toBeNull();
  });

  it('each branch id is independent', async () => {
    const el = renderPassage(
      '{#first timed 50ms}One{#second next 50ms}Two{/timed}',
    );
    await waitForText(el, 'One');
    expect(el.querySelector('#first')).not.toBeNull();
    expect(el.querySelector('#second')).toBeNull();

    await waitForText(el, 'Two');
    expect(el.querySelector('#second')).not.toBeNull();
    expect(el.querySelector('#first')).toBeNull();
  });

  it('renders without wrapper when no className or id', async () => {
    const el = renderPassage('{timed 50ms}Plain{next 50ms}Also plain{/timed}');
    await waitForText(el, 'Plain');
    // No wrapping span inside the passage div
    const passageDiv = el.querySelector('.passage')!;
    expect(passageDiv.querySelector('span')).toBeNull();

    await waitForText(el, 'Also plain');
    expect(passageDiv.querySelector('span')).toBeNull();
  });

  it('cycles through multiple branches with independent styles', async () => {
    const el = renderPassage(
      '{.a timed 50ms}One{.b next 50ms}Two{.c#end next 50ms}Three{/timed}',
    );
    // Section 0: class "a" only
    await waitForText(el, 'One');
    expect(el.querySelector('span.a')).not.toBeNull();
    expect(el.querySelector('.b')).toBeNull();
    expect(el.querySelector('.c')).toBeNull();

    // Section 1: class "b" only
    await waitForText(el, 'Two');
    expect(el.querySelector('span.b')).not.toBeNull();
    expect(el.querySelector('.a')).toBeNull();

    // Section 2: class "c", id "end"
    await waitForText(el, 'Three');
    const span = el.querySelector('span.c#end');
    expect(span).not.toBeNull();
    expect(span!.textContent).toBe('Three');
    expect(el.querySelector('.b')).toBeNull();
  });
});
