// @vitest-environment happy-dom
// The on-page banner for runtime errors, and its use for a session write
// that fails during navigation.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../../src/components/App';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import {
  clearRuntimeErrors,
  getRuntimeErrors,
  showRuntimeError,
} from '../../src/runtime-errors';
import type { StoryData, Passage } from '../../src/parser';

const passage = (pid: number, name: string, content: string): Passage => ({
  pid,
  name,
  tags: [],
  metadata: {},
  content,
});

function storyData(): StoryData {
  const ps = [
    passage(1, 'Start', 'Start'),
    passage(2, 'Room', 'Room'),
    passage(3, 'Hall', 'Hall'),
  ];
  return {
    name: 'Runtime errors',
    startNode: 1,
    ifid: 'runtime-errors',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(ps.map((p) => [p.name, p])),
    passagesById: new Map(ps.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

const banners = () => [
  ...document.querySelectorAll<HTMLElement>('.spindle-error-banner'),
];

describe('runtime error banner', () => {
  let container: HTMLElement;

  beforeEach(() => {
    _resetRuntimePhase();
    sessionStorage.clear();
    clearRuntimeErrors();
    useStoryStore.getState().init(storyData());
    container = document.createElement('div');
    document.body.append(container);
    act(() => render(<App />, container));
  });

  afterEach(() => {
    act(() => render(null, container));
    container.remove();
    clearRuntimeErrors();
  });

  it('shows nothing without errors', () => {
    expect(document.querySelector('.spindle-error-banners')).toBeNull();
  });

  it('shows an error as an alert the player can dismiss', () => {
    act(() =>
      showRuntimeError('Something failed:', new Error('spindle: Boom')),
    );
    const [banner] = banners();
    expect(banners()).toHaveLength(1);
    expect(banner!.getAttribute('role')).toBe('alert');
    expect(banner!.textContent).toContain('Something failed: Boom');
    expect(banner!.textContent).not.toContain('spindle:');

    const dismiss = banner!.querySelector<HTMLButtonElement>(
      'button.spindle-error-banner-dismiss',
    )!;
    expect(dismiss.getAttribute('aria-label')).toBe('Dismiss');
    act(() => dismiss.click());
    expect(banners()).toHaveLength(0);
    expect(getRuntimeErrors()).toHaveLength(0);
  });

  it('counts an error that happens again instead of repeating it', () => {
    act(() => {
      showRuntimeError('Failed:', new Error('A'));
      showRuntimeError('Failed:', new Error('A'));
      showRuntimeError('Failed:', 'B');
    });
    expect(banners().map((b) => b.textContent)).toEqual([
      'Failed: A (×2)✕',
      'Failed: B✕',
    ]);
  });

  it('shows a navigation to a passage that does not exist, and stays', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => useStoryStore.getState().navigate('Nowhere'));
    expect(useStoryStore.getState().currentPassage).toBe('Start');
    expect(banners().map((b) => b.textContent)).toEqual([
      'The story could not go to another passage: No passage named "Nowhere" (in passage "Start")✕',
    ]);
    expect(error).toHaveBeenCalledWith(
      'spindle: No passage named "Nowhere" (in passage "Start")',
    );
    error.mockRestore();
  });

  describe('when a navigation cannot write the session', () => {
    const session = () =>
      sessionStorage.getItem('spindle.session.runtime-errors');

    it('shows the error with its path, logs it, and keeps the last good session', () => {
      act(() => useStoryStore.getState().navigate('Room'));
      const lastGood = session();
      expect(lastGood).not.toBeNull();

      act(() => useStoryStore.getState().setVariable('cb', () => 1));
      let thrown: unknown;
      act(() => {
        try {
          useStoryStore.getState().navigate('Hall');
        } catch (err) {
          thrown = err;
        }
      });

      // The navigation completed, and still throws (the console gets it)
      expect(useStoryStore.getState().currentPassage).toBe('Hall');
      expect(String(thrown)).toContain('Cannot save a function (at $cb)');
      // The page shows it
      const [banner] = banners();
      expect(banner!.getAttribute('role')).toBe('alert');
      expect(
        banner!.querySelector('.spindle-error-banner-message')!.textContent,
      ).toBe('Cannot save a function (at $cb)');
      expect(banner!.textContent).toContain('page reload');
      // A reload would go back to Room
      expect(session()).toBe(lastGood);

      // Again on the next navigation: counted, not repeated
      act(() => {
        try {
          useStoryStore.getState().navigate('Room');
        } catch {
          // shown on the page
        }
      });
      expect(banners()).toHaveLength(1);
      expect(banners()[0]!.textContent).toContain('(×2)');
    });

    it('keeps the passage on the page while the banner shows', async () => {
      act(() => useStoryStore.getState().setVariable('cb', () => 1));
      const spy = vi.fn();
      act(() => {
        try {
          useStoryStore.getState().navigate('Room');
        } catch (err) {
          spy(err);
        }
      });
      expect(spy).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(container.querySelector('[data-passage="Room"]')).not.toBeNull(),
      );
      expect(banners()).toHaveLength(1);
    });
  });
});
