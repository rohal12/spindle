// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useStoryStore } from '../../src/store';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import type { StoryData, Passage as PassageData } from '../../src/parser';

// Ensure PassageDisplay macro is registered
import '../../src/components/macros/PassageDisplay';

function makePassage(
  pid: number,
  name: string,
  content: string,
  tags: string[] = [],
): PassageData {
  return { pid, name, tags, metadata: {}, content };
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

function renderPassageMacro(container: HTMLElement): void {
  const tokens = tokenize('{passage}');
  const ast = buildAST(tokens);
  act(() => {
    render(<>{renderNodes(ast)}</>, container);
  });
}

describe('PassageDisplay transition state machine', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    vi.useRealTimers();
  });

  it('renders with .passage-container wrapper and data-transition attribute', () => {
    const storyData = makeStoryData([makePassage(1, 'Start', 'Hello world')]);
    useStoryStore.getState().init(storyData);
    renderPassageMacro(container);

    const storyDiv = container.querySelector('#story');
    expect(storyDiv).not.toBeNull();

    const passageContainer = storyDiv!.querySelector('.passage-container');
    expect(passageContainer).not.toBeNull();

    const passageDiv = passageContainer!.querySelector('.passage');
    expect(passageDiv).not.toBeNull();
    expect(passageDiv!.getAttribute('data-passage')).toBe('Start');
    expect(passageDiv!.getAttribute('data-transition')).not.toBeNull();
  });

  it('sets data-transition="none" when no transition configured and first load uses fade', () => {
    const storyData = makeStoryData([makePassage(1, 'Start', 'Hello world')]);
    useStoryStore.getState().init(storyData);
    renderPassageMacro(container);

    const passageDiv = container.querySelector('.passage');
    expect(passageDiv).not.toBeNull();
    // First load should use 'fade' (not 'none')
    expect(passageDiv!.getAttribute('data-transition')).toBe('fade');
  });

  it('consumeNextTransition is consumed on navigation regardless of tags', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start'),
      makePassage(2, 'Room', 'A room', ['transition:none']),
    ]);
    useStoryStore.getState().init(storyData);

    // Set a next transition
    useStoryStore
      .getState()
      .setNextTransition({ type: 'crossfade', duration: 500 });

    renderPassageMacro(container);

    // Navigate
    act(() => {
      useStoryStore.getState().navigate('Room');
    });

    // Advance timers to complete transition
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    // nextTransition should have been consumed
    expect(useStoryStore.getState().nextTransition).toBeNull();
  });

  it('first passage uses fade behavior regardless of store default', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello', ['transition:crossfade']),
    ]);
    useStoryStore.getState().init(storyData);

    // Set a store default that is NOT fade
    useStoryStore
      .getState()
      .setTransition({ type: 'fade-through', duration: 500 });

    renderPassageMacro(container);

    const passageDiv = container.querySelector('.passage');
    expect(passageDiv).not.toBeNull();
    // Even with store default and tag, first passage should use fade
    expect(passageDiv!.getAttribute('data-transition')).toBe('fade');
  });

  it('renders passage content correctly', () => {
    const storyData = makeStoryData([makePassage(1, 'Start', 'Hello world')]);
    useStoryStore.getState().init(storyData);
    renderPassageMacro(container);

    expect(container.textContent).toContain('Hello world');
  });

  it('handles navigation between passages', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start content'),
      makePassage(2, 'Room', 'Room content'),
    ]);
    useStoryStore.getState().init(storyData);
    renderPassageMacro(container);

    expect(container.textContent).toContain('Start content');

    act(() => {
      useStoryStore.getState().navigate('Room');
    });

    // Advance timers to complete any transition
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(container.textContent).toContain('Room content');
  });

  it('renders PassageReady hidden div when present', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Hello'),
      makePassage(2, 'PassageReady', '{set $ready = true}'),
    ]);
    useStoryStore.getState().init(storyData);
    renderPassageMacro(container);

    // PassageReady content should exist but be hidden
    const hiddenDivs = container.querySelectorAll('[hidden]');
    expect(hiddenDivs.length).toBeGreaterThan(0);
  });

  it('shows error for missing passage', () => {
    const storyData = makeStoryData([makePassage(1, 'Start', 'Hello')]);
    useStoryStore.getState().init(storyData);

    // Force currentPassage to a non-existent passage
    act(() => {
      // Use internal state manipulation since navigate validates
      useStoryStore.setState({ currentPassage: 'NonExistent' });
    });

    renderPassageMacro(container);

    const error = container.querySelector('.error');
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain('NonExistent');
  });

  it('uses transition:none tag correctly after first load', () => {
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start'),
      makePassage(2, 'Room', 'Room', ['transition:none']),
    ]);
    useStoryStore.getState().init(storyData);
    renderPassageMacro(container);

    // Navigate to Room which has transition:none tag
    act(() => {
      useStoryStore.getState().navigate('Room');
    });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const passageDiv = container.querySelector('.passage');
    expect(passageDiv).not.toBeNull();
    expect(passageDiv!.getAttribute('data-transition')).toBe('none');
  });
});
