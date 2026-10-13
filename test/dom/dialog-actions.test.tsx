// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { TriggerDialogHost } from '../../src/components/TriggerDialogHost';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { resetTriggers } from '../../src/triggers';
import {
  clearActions,
  getAction,
  getActions,
  resetIdCounters,
} from '../../src/action-registry';
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
    name: 'Dialog Actions Test',
    startNode: 1,
    ifid: 'dialog-actions-test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

describe('dialog open and close actions (#540)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    resetTriggers();
    clearActions();
    resetIdCounters();
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          passage(1, 'Start', ''),
          passage(2, 'Inventory', 'Inventory content'),
        ]),
      );
    installStoryAPI();
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => render(null, container));
    container.remove();
  });

  const show = (content: string) =>
    act(() => {
      render(
        <>
          <TriggerDialogHost />
          <Passage passage={passage(1, 'Start', content)} />
        </>,
        container,
      );
    });
  const panels = () => container.querySelectorAll('.dialog-panel');
  const ofType = (type: string) => getActions().filter((a) => a.type === type);

  it('registers {dialog} as an open-dialog action that opens it', () => {
    show('{dialog "View Inventory"}Inventory{/dialog}');
    const action = getAction('open-dialog:"View Inventory"');
    expect(action).toMatchObject({
      type: 'open-dialog',
      label: 'View Inventory',
      target: 'Inventory',
    });
    expect(ofType('close-dialog')).toEqual([]);

    act(() => action!.perform());
    expect(panels()).toHaveLength(1);
  });

  it('uses the author #id for the open action', () => {
    show('{#inv dialog "View Inventory"}Inventory{/dialog}');
    expect(getAction('inv')?.type).toBe('open-dialog');
  });

  it('registers the close button while the dialog is shown', () => {
    show('{dialog "View Inventory"}Inventory{/dialog}');
    act(() => getAction('open-dialog:"View Inventory"')!.perform());
    const close = getAction('close-dialog:Inventory');
    expect(close).toMatchObject({
      type: 'close-dialog',
      label: 'Close',
      target: 'Inventory',
    });

    act(() => close!.perform());
    expect(panels()).toHaveLength(0);
    expect(ofType('close-dialog')).toEqual([]);
  });

  it('registers no close action for a noclose dialog', () => {
    show('{dialog "View Inventory" noclose}Inventory{/dialog}');
    act(() => getAction('open-dialog:"View Inventory" noclose')!.perform());
    expect(panels()).toHaveLength(1);
    expect(ofType('close-dialog')).toEqual([]);
  });

  it('closes a dialog opened through Story.openDialog()', () => {
    show('');
    act(() => window.Story.openDialog('Inventory'));
    expect(panels()).toHaveLength(1);
    act(() => getAction('close-dialog:Inventory')!.perform());
    expect(panels()).toHaveLength(0);
    expect(window.Story.isDialogOpen()).toBe(false);
  });
});
