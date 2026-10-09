// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function setup(vars: Record<string, unknown>, extra: PassageData[] = []) {
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

describe('email autolinks (#395)', () => {
  beforeEach(() => setup({}));

  it('renders a mailto link, not an element', () => {
    const el = renderPassage('Contact <support@example.com>.');
    const link = el.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('mailto:support@example.com');
    expect(link.textContent).toBe('support@example.com');
    expect(el.querySelector('support')).toBeNull();
  });

  it('keeps HTML elements and URL autolinks as they were', () => {
    const el = renderPassage(
      '<span class="x">a</span> <https://example.com> <a href="#top">b</a>',
    );
    expect(el.querySelector('span.x')!.textContent).toBe('a');
    expect(
      [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).toEqual(['https://example.com', '#top']);
  });
});
