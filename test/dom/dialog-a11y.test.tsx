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

function press(key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    document.dispatchEvent(event);
  });
  return event;
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
          makePassage(
            4,
            'Hint',
            '<button type="button" id="first">First</button>\n<details id="hint">\n<summary id="summary">Hint</summary>\n<button type="button" id="concealed">Hidden until expanded</button>\n</details>',
          ),
          makePassage(
            5,
            'Choice',
            '<button type="button" id="first">First</button>\n<div hidden><input type="radio" name="cls" id="locked"></div>\n<input type="radio" name="cls" id="warrior"> <input type="radio" name="cls" id="mage">',
          ),
          makePassage(
            6,
            'Checked',
            '<button type="button" id="first">First</button>\n<div hidden><input type="radio" name="cls" id="locked" checked></div>\n<input type="radio" name="cls" id="warrior"> <input type="radio" name="cls" id="mage">',
          ),
          makePassage(
            7,
            'HiddenAuto',
            '<input id="hidden-auto" hidden autofocus><input id="disabled-auto" disabled autofocus><button id="available">Continue</button>',
          ),
          makePassage(
            8,
            'Positive',
            '<button id="first" tabindex="1">First</button><button id="last" tabindex="3">Last</button>',
          ),
          makePassage(
            9,
            'Frame',
            '<iframe id="frame" srcdoc="<button id=\'embedded\'>Embedded</button>"></iframe>',
          ),
          makePassage(
            10,
            'Media',
            '<button id="before">Before</button><audio id="audio" controls tabindex="0"></audio><button id="after">After</button>',
          ),
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

  it('skips unavailable autofocus elements (#426)', () => {
    act(() => window.Story.openDialog('HiddenAuto'));
    expect(document.activeElement).toBe(byId('available'));
  });

  it('keeps Tab inside the dialog despite outside positive tabindexes (#424)', () => {
    const outside = document.createElement('button');
    outside.tabIndex = 2;
    document.body.appendChild(outside);
    try {
      act(() => window.Story.openDialog('Positive'));
      const close = container.querySelector('.dialog-close');
      expect(document.activeElement).toBe(byId('first'));
      press('Tab');
      expect(document.activeElement).toBe(byId('last'));
      press('Tab');
      expect(document.activeElement).toBe(close);
      press('Tab');
      expect(document.activeElement).toBe(byId('first'));
      press('Tab', true);
      expect(document.activeElement).toBe(close);
      press('Tab', true);
      expect(document.activeElement).toBe(byId('last'));
    } finally {
      outside.remove();
    }
  });

  it('leaves Tab to the native controls of a media element (#444)', () => {
    act(() => window.Story.openDialog('Media'));
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    try {
      byId('audio').focus();
      // The browser steps through the player's controls; the element stays
      // the active one, and the modal does not move focus
      const stepping = press('Tab');
      expect(stepping.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(byId('audio'));

      // From its last control the browser leaves the element, here out of
      // the dialog: focus goes on to the modal's next control instead
      press('Tab');
      act(() => outside.focus());
      expect(document.activeElement).toBe(byId('after'));

      byId('audio').focus();
      press('Tab', true);
      act(() => outside.focus());
      expect(document.activeElement).toBe(byId('before'));
    } finally {
      outside.remove();
    }
  });

  it('takes focus that leaves a media element for nothing (#444)', () => {
    act(() => window.Story.openDialog('Media'));
    byId('audio').focus();
    press('Tab');
    act(() => {
      byId('audio').blur();
    });
    expect(document.activeElement).toBe(byId('after'));
  });

  it('closes on Escape pressed inside an embedded document (#425)', () => {
    act(() => window.Story.openDialog('Frame'));
    const doc = (byId('frame') as HTMLIFrameElement).contentDocument;
    if (!doc) return; // no same-origin frame documents in this environment
    act(() => {
      doc.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(panels()).toHaveLength(0);
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

  const noClose = { showCloseButton: false, dismissible: false };

  it('wraps from the summary of a closed details element (#389)', () => {
    act(() => window.Story.openDialog('Hint', noClose));
    expect(document.activeElement).toBe(byId('first'));
    byId('summary').focus();
    press('Tab');
    expect(document.activeElement).toBe(byId('first'));
    press('Tab', true);
    expect(document.activeElement).toBe(byId('summary'));
  });

  it('wraps to the content of an open details element (#389)', () => {
    act(() => window.Story.openDialog('Hint', noClose));
    byId('hint').setAttribute('open', '');
    byId('first').focus();
    press('Tab', true);
    expect(document.activeElement).toBe(byId('concealed'));
  });

  it.each(['Choice', 'Checked'])(
    'tabs to the first visible radio when a hidden one leads its group (%s, #390)',
    (passage) => {
      act(() => window.Story.openDialog(passage, noClose));
      byId('first').focus();
      press('Tab', true);
      expect(document.activeElement).toBe(byId('warrior'));
      press('Tab');
      expect(document.activeElement).toBe(byId('first'));
    },
  );

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
