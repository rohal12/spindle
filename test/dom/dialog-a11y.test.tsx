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
    name: 'Dialog A11y Test',
    startNode: 1,
    ifid: 'dialog-a11y-test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

function press(key: string, shiftKey = false): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }),
    );
  });
}

describe('dialog accessibility', () => {
  let container: HTMLElement;
  let opener: HTMLButtonElement;

  beforeEach(() => {
    resetTriggers();
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(1, 'Start', 'Hello'),
          makePassage(
            2,
            'Form',
            '<button id="first">A</button> <button id="second">B</button> <button id="last">OK</button>',
          ),
          makePassage(3, 'Plain', 'Just text'),
        ]),
      );
    installStoryAPI();
    opener = document.createElement('button');
    opener.textContent = 'Open';
    document.body.appendChild(opener);
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(<TriggerDialogHost />, container);
    });
    opener.focus();
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    container.remove();
    opener.remove();
  });

  const panels = () => container.querySelectorAll<HTMLElement>('.dialog-panel');
  const byId = (id: string) => document.getElementById(id)!;

  it('marks the panel as a modal dialog and labels the close button', () => {
    act(() => window.Story.openDialog('Plain'));
    const panel = panels()[0]!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.getAttribute('tabindex')).toBe('-1');
    expect(
      container.querySelector('.dialog-close')!.getAttribute('aria-label'),
    ).toBe('Close');
  });

  it('focuses the first focusable element of the body, skipping the close button', () => {
    act(() => window.Story.openDialog('Form'));
    expect(document.activeElement).toBe(byId('first'));
  });

  it('focuses the panel when the body has nothing focusable', () => {
    act(() => window.Story.openDialog('Plain'));
    expect(document.activeElement).toBe(panels()[0]);
  });

  it('returns focus to the opener on close', () => {
    act(() => window.Story.openDialog('Form'));
    expect(document.activeElement).not.toBe(opener);
    act(() => window.Story.closeDialog());
    expect(document.activeElement).toBe(opener);
  });

  it('wraps Tab and Shift+Tab inside the dialog', () => {
    act(() => window.Story.openDialog('Form'));
    // Tab order: close button, #first, #second, #last
    byId('last').focus();
    press('Tab');
    expect(document.activeElement).toBe(
      container.querySelector('.dialog-close'),
    );

    press('Tab', true);
    expect(document.activeElement).toBe(byId('last'));
  });

  it('pulls focus back into the dialog when it escaped', () => {
    act(() => window.Story.openDialog('Form'));
    opener.focus();
    press('Tab');
    expect(panels()[0]!.contains(document.activeElement)).toBe(true);
  });

  it('closes a dismissible dialog on Escape', () => {
    act(() => window.Story.openDialog('Form'));
    press('Escape');
    expect(window.Story.isDialogOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('ignores Escape for a non-dismissible dialog', () => {
    act(() => window.Story.openDialog('Form', { dismissible: false }));
    press('Escape');
    expect(window.Story.isDialogOpen()).toBe(true);
  });

  it('only the topmost stacked dialog handles Escape and gets focus back', () => {
    act(() => window.Story.openDialog('Form'));
    act(() => window.Story.openDialog('Plain'));
    expect(panels()).toHaveLength(2);
    expect(document.activeElement).toBe(panels()[1]);

    press('Escape');
    expect(panels()).toHaveLength(1);
    // Focus returns to what was focused in the first dialog
    expect(document.activeElement).toBe(byId('first'));

    press('Escape');
    expect(panels()).toHaveLength(0);
    expect(document.activeElement).toBe(opener);
  });
});
