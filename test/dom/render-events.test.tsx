// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { resetEmitter } from '../../src/event-emitter';
import { connectTriggersToStore, resetTriggers } from '../../src/triggers';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import { TriggerDialogHost } from '../../src/components/TriggerDialogHost';
import { PassageDialog } from '../../src/components/PassageDialog';
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

describe('dialogclose event', () => {
  let container: HTMLElement;
  let opener: HTMLButtonElement;
  let other: HTMLButtonElement;
  let disconnect: () => void;
  let closed: string[];

  /** dialogclose fires once the render pass that closed the dialog is over. */
  const afterRender = () => Promise.resolve();
  const panels = () => container.querySelectorAll('.dialog-panel');
  const click = (selector: string) =>
    act(() => container.querySelector<HTMLElement>(selector)!.click());
  const open = (name: string) => act(() => window.Story.openDialog(name));

  beforeEach(() => {
    resetEmitter();
    resetTriggers();
    // The handlers are the story JavaScript's, which a restart keeps
    _resetRuntimePhase();
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(
            1,
            'Start',
            `{dialog "Open"}Panel{/dialog} {saves} {watch '$n > 0' dialog "Alert"}`,
          ),
          makePassage(2, 'Room', 'A room'),
          makePassage(3, 'Menu', 'Pick one {$shown}'),
          makePassage(4, 'Panel', 'Panel content {$shown}'),
          makePassage(5, 'SaveLoad', 'Saved games {$shown}'),
          makePassage(6, 'Alert', 'Alert {$shown}'),
        ]),
        { n: 0, shown: 0 },
      );
    useStoryStore.getState().setTransition({ type: 'none' });
    installStoryAPI();
    disconnect = connectTriggersToStore();
    container = document.createElement('div');
    opener = document.createElement('button');
    other = document.createElement('button');
    document.body.append(opener, other, container);
    renderApp(container);
    opener.focus();
    closed = [];
    window.Story.on('dialogclose', (passage) => closed.push(passage));
  });

  afterEach(async () => {
    act(() => {
      render(null, container);
    });
    // The dialogs a test left open close here, before the next test listens
    await afterRender();
    disconnect();
    container.remove();
    opener.remove();
    other.remove();
  });

  it('fires with the passage of dialogrender once the dialog is out of the DOM', async () => {
    let panel: HTMLElement | undefined;
    window.Story.on('dialogrender', (_passage, el) => {
      panel = el;
    });
    const seen: unknown[] = [];
    window.Story.on('dialogclose', (passage) => {
      seen.push([
        passage,
        panel!.isConnected,
        document.querySelector('.dialog-panel'),
        window.Story.isDialogOpen(),
      ]);
    });

    open('Menu');
    await afterRender();
    expect(seen).toEqual([]);

    act(() => window.Story.closeDialog());
    await afterRender();
    expect(seen).toEqual([['Menu', false, null, false]]);
  });

  it.each<[string, () => void]>([
    ['the ✕ button', () => click('.dialog-close')],
    [
      'Escape',
      () =>
        act(() => {
          document.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              cancelable: true,
            }),
          );
        }),
    ],
    ['a backdrop click', () => click('.dialog-overlay')],
    ['Story.closeDialog()', () => act(() => window.Story.closeDialog())],
    [
      'Story.closeAllDialogs()',
      () => act(() => window.Story.closeAllDialogs()),
    ],
    ['a restart', () => act(() => window.Story.restart())],
    [
      'unmounting what holds it',
      () =>
        act(() => {
          render(null, container);
        }),
    ],
  ])('fires once for a dialog closed by %s', async (_way, close) => {
    open('Menu');
    expect(panels()).toHaveLength(1);

    close();
    expect(panels()).toHaveLength(0);
    await afterRender();
    expect(closed).toEqual(['Menu']);

    // Nothing more on later renders
    act(() => useStoryStore.getState().setVariable('shown', 1));
    await afterRender();
    expect(closed).toEqual(['Menu']);
  });

  it.each<[string, string, () => void]>([
    ['{dialog}', 'Panel', () => click('button.macro-dialog')],
    ['the menubar Saves button', 'SaveLoad', () => click('.menubar-button')],
    [
      '{watch … dialog}',
      'Alert',
      () => act(() => useStoryStore.getState().setVariable('n', 1)),
    ],
  ])('fires for a dialog opened by %s', async (_opener, passage, openIt) => {
    const rendered: string[] = [];
    window.Story.on('dialogrender', (name) => rendered.push(name));

    openIt();
    expect(rendered).toEqual([passage]);
    // The dialog's content rendering again is no close
    act(() => useStoryStore.getState().setVariable('shown', 1));
    await afterRender();
    expect(panels()[0]!.textContent).toContain('1');
    expect(closed).toEqual([]);

    click('.dialog-close');
    await afterRender();
    expect(closed).toEqual([passage]);
  });

  it('passes an empty passage for a dialog without one, as dialogrender does', async () => {
    const rendered: string[] = [];
    window.Story.on('dialogrender', (name) => rendered.push(name));
    const host = document.createElement('div');
    document.body.appendChild(host);
    act(() => {
      render(
        <PassageDialog
          fallbackMarkup="Built in"
          onClose={() => {}}
        />,
        host,
      );
    });
    act(() => {
      render(null, host);
    });
    host.remove();
    await afterRender();

    expect(rendered).toEqual(['']);
    expect(closed).toEqual(['']);
  });

  it('fires when a passage is left with its {dialog} open', async () => {
    click('button.macro-dialog');
    expect(panels()).toHaveLength(1);

    act(() => window.Story.goto('Room'));
    await afterRender();
    expect(panels()).toHaveLength(0);
    expect(closed).toEqual(['Panel']);
  });

  it('fires after focus is back on the opener, so a handler can move it', async () => {
    const focused: Array<Element | null> = [];
    window.Story.on('dialogclose', () => {
      focused.push(document.activeElement);
      other.focus();
    });

    open('Menu');
    expect(container.contains(document.activeElement)).toBe(true);
    click('.dialog-close');
    await afterRender();

    expect(focused).toEqual([opener]);
    expect(document.activeElement).toBe(other);
  });

  it('lets a handler place focus when the opener is gone', async () => {
    window.Story.on('dialogclose', () => other.focus());

    open('Menu');
    opener.remove();
    act(() => window.Story.closeDialog());
    await afterRender();

    expect(document.activeElement).toBe(other);
  });

  it('fires for each stacked dialog as it closes, while the others are open', async () => {
    const stillOpen: boolean[] = [];
    window.Story.on('dialogclose', () => {
      stillOpen.push(window.Story.isDialogOpen());
    });
    open('Menu');
    open('Room');

    act(() => window.Story.closeDialog());
    await afterRender();
    expect(closed).toEqual(['Room']);
    expect(stillOpen).toEqual([true]);

    act(() => window.Story.closeDialog());
    await afterRender();
    expect(closed).toEqual(['Room', 'Menu']);
    expect(stillOpen).toEqual([true, false]);
  });

  it('fires innermost first for dialogs closed together, with focus restored', async () => {
    const seen: Array<[string, boolean, Element | null]> = [];
    window.Story.on('dialogclose', (passage) => {
      seen.push([passage, window.Story.isDialogOpen(), document.activeElement]);
    });
    open('Menu');
    // A {dialog} over a dialog of the API, and one of the API over both
    click('button.macro-dialog');
    open('Room');
    expect(panels()).toHaveLength(3);

    act(() => window.Story.closeAllDialogs());
    await afterRender();
    expect(seen).toEqual([
      ['Room', false, opener],
      ['Panel', false, opener],
      ['Menu', false, opener],
    ]);
  });

  it('fires after storyinit for the dialogs a restart closes', async () => {
    const order: string[] = [];
    window.Story.on('storyinit', () => order.push('storyinit'));
    window.Story.on('dialogclose', (passage) => order.push(passage));
    click('button.macro-dialog');
    open('Menu');

    act(() => window.Story.restart());
    await afterRender();
    expect(panels()).toHaveLength(0);
    expect(order).toEqual(['storyinit', 'Menu', 'Panel']);
  });

  it('logs a throwing handler and still calls the others', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    resetEmitter();
    window.Story.on('dialogclose', () => {
      throw new Error('boom');
    });
    const after = vi.fn();
    window.Story.on('dialogclose', after);

    open('Menu');
    open('Room');
    act(() => window.Story.closeAllDialogs());
    await afterRender();

    expect(after.mock.calls).toEqual([['Room'], ['Menu']]);
    expect(error).toHaveBeenCalledWith(
      'spindle: Error in dialogclose handler:',
      expect.any(Error),
    );
    // Rendering goes on
    open('Menu');
    expect(panels()).toHaveLength(1);
    error.mockRestore();
  });
});
