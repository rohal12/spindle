// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { TriggerDialogHost } from '../../src/components/TriggerDialogHost';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { resetTriggers } from '../../src/triggers';
import type { StoryData, Passage as PassageData } from '../../src/parser';

const passage = (pid: number, name: string, content: string): PassageData => ({
  pid,
  name,
  tags: [],
  metadata: {},
  content,
});

function makeStoryData(passages: PassageData[]): StoryData {
  return {
    name: 'Dialog API Test',
    startNode: 1,
    ifid: 'dialog-api-test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

describe('Story dialog API with {dialog} (#286)', () => {
  let container: HTMLElement;
  const start = passage(1, 'Start', '{dialog "Open"}Panel{/dialog}');

  beforeEach(() => {
    resetTriggers();
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          start,
          passage(2, 'Panel', 'Panel content'),
          passage(3, 'Host', 'Host content'),
        ]),
      );
    installStoryAPI();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(
        <>
          <TriggerDialogHost />
          <Passage passage={start} />
        </>,
        container,
      );
    });
  });

  afterEach(() => {
    act(() => render(null, container));
    container.remove();
  });

  const open = () =>
    act(() => {
      (container.querySelector('button.macro-dialog') as HTMLElement).click();
    });
  const panels = () => container.querySelectorAll('.dialog-panel');

  it('reports a macro dialog as open and closes it', () => {
    expect(window.Story.isDialogOpen()).toBe(false);
    open();
    expect(panels()).toHaveLength(1);
    expect(window.Story.isDialogOpen()).toBe(true);
    act(() => window.Story.closeDialog());
    expect(panels()).toHaveLength(0);
    expect(window.Story.isDialogOpen()).toBe(false);
  });

  it('closes all dialogs, host and macro', () => {
    act(() => window.Story.openDialog('Host'));
    open();
    expect(panels()).toHaveLength(2);
    act(() => window.Story.closeAllDialogs());
    expect(panels()).toHaveLength(0);
    expect(window.Story.isDialogOpen()).toBe(false);
  });

  it('closes the topmost dialog, not the host dialog underneath', () => {
    act(() => window.Story.openDialog('Host'));
    open();
    act(() => window.Story.closeDialog());
    expect(panels()).toHaveLength(1);
    expect(container.textContent).toContain('Host content');
    expect(window.Story.isDialogOpen()).toBe(true);
  });
});
