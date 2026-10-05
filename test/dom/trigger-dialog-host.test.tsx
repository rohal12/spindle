// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { TriggerDialogHost } from '../../src/components/TriggerDialogHost';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { resetTriggers } from '../../src/triggers';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[]): StoryData {
  return {
    name: 'Dialog Host Test',
    startNode: 1,
    ifid: 'dialog-host-test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

describe('TriggerDialogHost + Story.openDialog', () => {
  let container: HTMLElement;

  beforeEach(() => {
    resetTriggers();
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(1, 'Start', 'Hello'),
          makePassage(2, 'Choice', 'Pick one'),
        ]),
      );
    installStoryAPI();
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(<TriggerDialogHost />, container);
    });
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    container.remove();
  });

  const overlay = () =>
    container.querySelector('.dialog-overlay') as HTMLElement | null;

  it('closes a default dialog on backdrop click', () => {
    act(() => {
      window.Story.openDialog('Choice');
    });
    expect(overlay()).not.toBeNull();
    expect(container.querySelector('.dialog-close')).not.toBeNull();

    act(() => {
      overlay()!.click();
    });
    expect(overlay()).toBeNull();
    expect(window.Story.isDialogOpen()).toBe(false);
  });

  it('keeps a non-dismissible dialog open until closed programmatically', () => {
    act(() => {
      window.Story.openDialog('Choice', { dismissible: false });
    });
    expect(overlay()).not.toBeNull();
    expect(container.querySelector('.dialog-close')).toBeNull();
    expect(container.querySelector('.dialog-body')!.textContent).toBe(
      'Pick one',
    );

    act(() => {
      overlay()!.click();
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(overlay()).not.toBeNull();
    expect(window.Story.isDialogOpen()).toBe(true);

    act(() => {
      window.Story.closeDialog();
    });
    expect(overlay()).toBeNull();
    expect(window.Story.isDialogOpen()).toBe(false);
  });

  it('applies dismissible per dialog in a stack', () => {
    act(() => {
      window.Story.openDialog('Choice', { dismissible: false });
      window.Story.openDialog('Start');
    });
    expect(container.querySelectorAll('.dialog-overlay')).toHaveLength(2);

    // Top dialog is dismissible: backdrop click closes it
    act(() => {
      (container.querySelectorAll('.dialog-overlay')[1] as HTMLElement).click();
    });
    expect(container.querySelectorAll('.dialog-overlay')).toHaveLength(1);

    // The remaining one is not
    act(() => {
      overlay()!.click();
    });
    expect(container.querySelectorAll('.dialog-overlay')).toHaveLength(1);
  });
});
