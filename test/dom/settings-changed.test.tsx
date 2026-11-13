// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { settings } from '../../src/settings';
import { on, resetEmitter } from '../../src/event-emitter';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function setup(): void {
  const passages = [makePassage(1, 'Start', 'Start')];
  const data: StoryData = {
    name: 'Test',
    startNode: 1,
    ifid: 'settings-changed',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
  useStoryStore.getState().init(data);
}

function renderControls(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(
      <Passage passage={makePassage(99, 'Test', '{settings-controls}')} />,
      container,
    );
  });
  return container;
}

describe('settingchanged from the settings controls', () => {
  beforeEach(() => {
    resetEmitter();
    localStorage.clear();
    settings.getDefinitions().clear();
    setup();
    // Values stay in the module between tests: start from the defaults
    settings.addToggle('music', { label: 'Music', default: true });
    settings.set('music', true);
    settings.addList('theme', {
      label: 'Theme',
      options: ['light', 'dark'],
      default: 'light',
    });
    settings.set('theme', 'light');
    resetEmitter();
  });

  it('fires once for a toggle and a list, with the new values', () => {
    const cb = vi.fn();
    on('settingchanged', cb);
    const el = renderControls();
    // Showing the controls is not a change
    expect(cb).not.toHaveBeenCalled();

    const checkbox = el.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    )!;
    act(() => {
      checkbox.checked = false;
      checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(cb).toHaveBeenCalledExactlyOnceWith('music', false);

    const select = el.querySelector<HTMLSelectElement>('select')!;
    act(() => {
      select.value = 'dark';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith('theme', 'dark');
  });

  it('fires once when Story.settings.set() changes a setting the controls show', () => {
    const cb = vi.fn();
    on('settingchanged', cb);
    renderControls();
    act(() => settings.set('music', false));
    expect(cb).toHaveBeenCalledExactlyOnceWith('music', false);
  });
});
