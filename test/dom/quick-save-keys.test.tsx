// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { App } from '../../src/components/App';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { clearActions, resetIdCounters } from '../../src/action-registry';
import type { StoryData, Passage } from '../../src/parser';

function makeStoryData(): StoryData {
  const start: Passage = {
    pid: 1,
    name: 'Start',
    tags: [],
    metadata: {},
    content: 'Hello',
  };
  return {
    name: 'Quick Keys',
    startNode: 1,
    ifid: 'quick-keys-test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map([['Start', start]]),
    passagesById: new Map([[1, start]]),
    userCSS: '',
    userScript: '',
  };
}

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
}

describe('quick save / quick load hotkeys', () => {
  const original = {
    save: useStoryStore.getState().save,
    load: useStoryStore.getState().load,
  };
  let save: ReturnType<typeof vi.fn>;
  let load: ReturnType<typeof vi.fn>;
  let container: HTMLElement;

  beforeEach(() => {
    clearActions();
    resetIdCounters();
    useStoryStore.getState().init(makeStoryData());
    installStoryAPI();
    save = vi.fn();
    load = vi.fn();
    useStoryStore.setState({ save, load });
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(<App />, container);
    });
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    container.remove();
    useStoryStore.setState({
      ...original,
      quickSaveKey: 'F6',
      quickLoadKey: 'F9',
    });
  });

  const button = (text: string) =>
    [...container.querySelectorAll('button')].find(
      (b) => b.textContent === text,
    )!;

  it('defaults to F6 / F9', () => {
    expect(window.Story.config.quickSaveKey).toBe('F6');
    expect(window.Story.config.quickLoadKey).toBe('F9');

    expect(press('F6').defaultPrevented).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(press('F9').defaultPrevented).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);

    expect(button('QuickSave').title).toBe('Quick Save (F6)');
    expect(button('QuickLoad').title).toBe('Quick Load (F9)');
  });

  it('null disables a shortcut and leaves the key alone', () => {
    act(() => {
      window.Story.config.quickSaveKey = null;
      window.Story.config.quickLoadKey = null;
    });

    expect(press('F6').defaultPrevented).toBe(false);
    expect(press('F9').defaultPrevented).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();

    expect(button('QuickSave').title).toBe('Quick Save');
    expect(button('QuickLoad').title).toBe('Quick Load');
  });

  it('rebinds a shortcut to another key', () => {
    act(() => {
      window.Story.config.quickSaveKey = 'F2';
    });

    press('F6');
    expect(save).not.toHaveBeenCalled();
    press('F2');
    expect(save).toHaveBeenCalledTimes(1);
    // Quick load is unaffected
    press('F9');
    expect(load).toHaveBeenCalledTimes(1);

    expect(button('QuickSave').title).toBe('Quick Save (F2)');
  });

  it('keeps the configured keys across restart', () => {
    act(() => {
      window.Story.config.quickLoadKey = null;
    });
    act(() => {
      useStoryStore.getState().restart();
    });

    expect(window.Story.config.quickLoadKey).toBeNull();
    press('F9');
    expect(load).not.toHaveBeenCalled();
  });
});
