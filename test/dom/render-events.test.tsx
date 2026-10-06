// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { resetTriggers } from '../../src/triggers';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { TriggerDialogHost } from '../../src/components/TriggerDialogHost';
import type { StoryData, Passage as PassageData } from '../../src/parser';
import '../../src/components/macros/PassageDisplay';

function makePassage(
  pid: number,
  name: string,
  content: string,
  tags: string[] = [],
): PassageData {
  return { pid, name, tags, metadata: {}, content };
}

function makeStoryData(passages: PassageData[]): StoryData {
  return {
    name: 'Render Events',
    startNode: 1,
    ifid: 'render-events',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

function renderApp(container: HTMLElement): void {
  const ast = parseMarkup('{passage}');
  act(() => {
    render(
      <>
        {renderNodes(ast)}
        <TriggerDialogHost />
      </>,
      container,
    );
  });
}

describe('passagerender / dialogrender events', () => {
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    resetEmitter();
    resetTriggers();
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(1, 'Start', 'Hello'),
          makePassage(2, 'Room', 'A room'),
          makePassage(3, 'Menu', 'Pick one'),
        ]),
      );
    installStoryAPI();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    container.remove();
    vi.useRealTimers();
  });

  it('fires passagerender with the committed .passage element on first render', () => {
    const seen: Array<[string, boolean, string | null]> = [];
    window.Story.on('passagerender', (name, el) => {
      seen.push([name, el.isConnected, el.getAttribute('data-passage')]);
    });
    renderApp(container);
    expect(seen).toEqual([['Start', true, 'Start']]);
  });

  it('fires once per navigation, with the content already rendered', () => {
    renderApp(container);
    const texts: string[] = [];
    window.Story.on('passagerender', (_name, el) => {
      texts.push(el.textContent ?? '');
    });

    act(() => {
      useStoryStore.getState().setTransition({ type: 'none' });
      window.Story.goto('Room');
    });
    expect(texts).toEqual(['A room']);

    act(() => {
      window.Story.back();
    });
    expect(texts).toEqual(['A room', 'Hello']);
  });

  it('fires after a fade-through transition mounts the new passage, never for the snapshot', () => {
    renderApp(container);
    const seen: Array<[string, boolean]> = [];
    window.Story.on('passagerender', (name, el) => {
      seen.push([name, el.classList.contains('passage')]);
    });

    act(() => {
      useStoryStore
        .getState()
        .setTransition({ type: 'fade-through', duration: 100, pause: 50 });
      window.Story.goto('Room');
    });
    // Outgoing phase: the new passage is not mounted yet
    expect(seen).toEqual([]);

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(seen).toEqual([['Room', true]]);
  });

  it('fires dialogrender with the dialog panel once the dialog is in the DOM', () => {
    renderApp(container);
    const seen: Array<[string, boolean, string]> = [];
    window.Story.on('dialogrender', (name, el) => {
      seen.push([name, el.isConnected, el.textContent ?? '']);
    });

    act(() => {
      window.Story.openDialog('Menu', { panelClass: 'menu-panel' });
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]![0]).toBe('Menu');
    expect(seen[0]![1]).toBe(true);
    expect(seen[0]![2]).toContain('Pick one');
    expect(
      container
        .querySelector('.dialog-panel')!
        .classList.contains('menu-panel'),
    ).toBe(true);
  });

  it('logs a throwing handler instead of breaking the render', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const after = vi.fn();
    window.Story.on('passagerender', () => {
      throw new Error('boom');
    });
    window.Story.on('passagerender', after);

    renderApp(container);

    expect(container.querySelector('.passage')!.textContent).toBe('Hello');
    expect(after).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'spindle: Error in passagerender handler:',
      expect.any(Error),
    );
    error.mockRestore();
  });
});
