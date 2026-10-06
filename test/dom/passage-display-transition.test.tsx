// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useStoryStore } from '../../src/store';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { loadSession } from '../../src/saves/save-manager';
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
  const ast = parseMarkup('{passage}');
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
    act(() => {
      render(null, container);
    });
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

  it.each(['fade-through', 'crossfade'] as const)(
    'cancels a running %s transition on unmount',
    (type) => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Start'),
        makePassage(2, 'Room', 'A room'),
      ]);
      useStoryStore.getState().init(storyData);
      useStoryStore.getState().setTransition({ type, duration: 500 });
      renderPassageMacro(container);

      act(() => {
        useStoryStore.getState().navigate('Room');
      });
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      act(() => {
        render(null, container);
      });
      expect(vi.getTimerCount()).toBe(0);
    },
  );

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

  describe('deferred render', () => {
    it('shows StoryLoading passage content when renderDeferred is true', () => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Start content'),
        makePassage(2, 'StoryLoading', 'Loading, please wait...'),
      ]);
      useStoryStore.getState().init(storyData);
      useStoryStore.getState().deferRender();

      renderPassageMacro(container);

      expect(container.textContent).toContain('Loading, please wait...');
      expect(container.textContent).not.toContain('Start content');
    });

    it('shows empty content when renderDeferred is true and no StoryLoading passage', () => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Start content'),
      ]);
      useStoryStore.getState().init(storyData);
      useStoryStore.getState().deferRender();

      renderPassageMacro(container);

      expect(container.textContent).not.toContain('Start content');
    });

    it('shows current passage after clearDeferredRender', () => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Start content'),
        makePassage(2, 'StoryLoading', 'Loading...'),
      ]);
      useStoryStore.getState().init(storyData);
      useStoryStore.getState().deferRender();

      renderPassageMacro(container);
      expect(container.textContent).toContain('Loading...');

      act(() => {
        useStoryStore.getState().clearDeferredRender();
      });

      expect(container.textContent).toContain('Start content');
      expect(container.textContent).not.toContain('Loading...');
    });

    it('navigation during deferred render updates store but display stays on StoryLoading', () => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Start content'),
        makePassage(2, 'Room', 'Room content'),
        makePassage(3, 'StoryLoading', 'Loading...'),
      ]);
      useStoryStore.getState().init(storyData);
      useStoryStore.getState().deferRender();

      renderPassageMacro(container);
      expect(container.textContent).toContain('Loading...');

      // Navigate while deferred
      act(() => {
        useStoryStore.getState().navigate('Room');
      });

      // Store updated but display still shows loading
      expect(useStoryStore.getState().currentPassage).toBe('Room');
      expect(container.textContent).toContain('Loading...');
      expect(container.textContent).not.toContain('Room content');

      // Clear deferred → shows the navigated-to passage
      act(() => {
        useStoryStore.getState().clearDeferredRender();
      });

      // Advance timers to complete any transition
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(container.textContent).toContain('Room content');
    });
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

describe('PassageDisplay remounts on every navigation', () => {
  let container: HTMLElement;

  const counter = '{set $x = $x + 1}<span id="result">{$x}</span>';

  function result(): string | null | undefined {
    return container.querySelector('#result')?.textContent;
  }

  function settle(): void {
    act(() => {
      vi.advanceTimersByTime(2000);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    document.body.removeChild(container);
    useStoryStore.getState().setTransition(null);
    vi.useRealTimers();
  });

  it('re-runs the passage when navigating to the same passage', () => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'A', counter)]), { x: 0 });
    renderPassageMacro(container);
    expect(result()).toBe('1');

    act(() => {
      useStoryStore.getState().navigate('A');
    });
    settle();
    expect(useStoryStore.getState().visitCounts.A).toBe(2);
    expect(result()).toBe('2');
  });

  it('re-runs the start passage on restart while it is displayed', () => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'A', counter)]), { x: 0 });
    renderPassageMacro(container);
    expect(result()).toBe('1');

    act(() => {
      useStoryStore.getState().restart();
    });
    settle();
    expect(result()).toBe('1');
    expect(useStoryStore.getState().variables.x).toBe(1);
  });

  it('re-runs the passage on back/forward between same-name moments', () => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'A', counter)]), { x: 0 });
    renderPassageMacro(container);
    act(() => {
      useStoryStore.getState().navigate('A');
    });
    settle();
    expect(result()).toBe('2');

    act(() => {
      useStoryStore.getState().goBack();
    });
    settle();
    expect(result()).toBe('1');

    act(() => {
      useStoryStore.getState().goForward();
    });
    settle();
    expect(result()).toBe('2');
  });

  it('re-runs the passage when loading a save of the visible passage', () => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'A', counter)]), { x: 0 });
    renderPassageMacro(container);
    const payload = useStoryStore.getState().getSavePayload();
    act(() => {
      useStoryStore.getState().setVariable('x', 10);
    });
    expect(result()).toBe('10');

    act(() => {
      useStoryStore.getState().loadFromPayload(payload);
    });
    settle();
    // The entry snapshot (x = 0) is restored and the passage runs once more
    expect(result()).toBe('1');
  });

  it('runs the passage once when a page refresh restores the session', () => {
    sessionStorage.clear();
    const storyData = () =>
      makeStoryData([
        makePassage(1, 'S', 'start'),
        makePassage(2, 'A', counter),
      ]);
    useStoryStore.getState().init(storyData(), { x: 0 });
    renderPassageMacro(container);
    act(() => {
      useStoryStore.getState().navigate('A');
    });
    settle();
    expect(result()).toBe('1');
    // A change made on the passage after entering it is not restored
    act(() => {
      useStoryStore.getState().setVariable('x', 10);
    });

    // Refresh: tear down, re-init, restore the session, render again
    act(() => {
      render(null, container);
    });
    useStoryStore.getState().init(storyData(), { x: 0 });
    useStoryStore.getState().loadFromPayload(loadSession('test')!);
    renderPassageMacro(container);
    settle();
    expect(result()).toBe('1');
  });

  it('re-runs PassageReady when navigating to the same passage', () => {
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(1, 'A', 'A'),
          makePassage(2, 'PassageReady', '{set $ready = $ready + 1}'),
        ]),
        { ready: 0 },
      );
    renderPassageMacro(container);
    expect(useStoryStore.getState().variables.ready).toBe(1);

    act(() => {
      useStoryStore.getState().navigate('A');
    });
    settle();
    expect(useStoryStore.getState().variables.ready).toBe(2);
  });

  it.each(['fade', 'fade-through', 'crossfade'] as const)(
    'runs a %s transition when revisiting the same passage',
    (type) => {
      useStoryStore
        .getState()
        .init(makeStoryData([makePassage(1, 'A', counter)]), { x: 0 });
      useStoryStore.getState().setTransition({ type, duration: 300 });
      renderPassageMacro(container);

      act(() => {
        useStoryStore.getState().navigate('A');
      });
      if (type !== 'fade') {
        expect(container.querySelector('.passage-snapshot')).not.toBeNull();
      }
      settle();
      expect(container.querySelector('.passage-snapshot')).toBeNull();
      expect(
        container.querySelector('.passage')!.getAttribute('data-transition'),
      ).toBe(type);
      expect(result()).toBe('2');
    },
  );
});
