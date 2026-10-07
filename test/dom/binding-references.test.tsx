// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage as PassageData } from '../../src/parser';

const start: PassageData = {
  pid: 1,
  name: 'Start',
  tags: [],
  metadata: {},
  content: '',
};

const storyData: StoryData = {
  name: 'Test',
  startNode: 1,
  ifid: 'test',
  format: 'spindle',
  formatVersion: '0.1.0',
  passages: new Map([['Start', start]]),
  passagesById: new Map([[1, start]]),
  userCSS: '',
  userScript: '',
};

const vars = () => useStoryStore.getState().variables as Record<string, any>;

describe('input bindings below a shared object (#305)', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(storyData, { a: { name: 'old' }, b: { name: 'old' } }, {});
    installStoryAPI();
  });

  it('keeps variables sharing the bound object one object', () => {
    const container = document.createElement('div');
    const passage: PassageData = {
      ...start,
      content: '{set $b = $a}\n{textbox $a.name}\nB: {$b.name}',
    };
    act(() => {
      render(<Passage passage={passage} />, container);
    });
    const input = container.querySelector('input')!;
    act(() => {
      input.value = 'new';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(vars().a.name).toBe('new');
    expect(vars().b.name).toBe('new');
    expect(vars().a).toBe(vars().b);
  });
});
