// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { TriggerDialogHost } from '../../src/components/TriggerDialogHost';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function setup(vars: Record<string, unknown>, extra: PassageData[] = []) {
  const passages = [makePassage(1, 'Start', 'Start'), ...extra];
  const data: StoryData = {
    name: 'Test',
    startNode: 1,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
  useStoryStore.getState().init(data, vars);
  installStoryAPI();
}

function renderPassage(content: string): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  return container;
}

describe('email autolinks (#395)', () => {
  beforeEach(() => setup({}));

  it('renders a mailto link, not an element', () => {
    const el = renderPassage('Contact <support@example.com>.');
    const link = el.querySelector('a')!;
    expect(link.getAttribute('href')).toBe('mailto:support@example.com');
    expect(link.textContent).toBe('support@example.com');
    expect(el.querySelector('support')).toBeNull();
  });

  it('keeps HTML elements and URL autolinks as they were', () => {
    const el = renderPassage(
      '<span class="x">a</span> <https://example.com> <a href="#top">b</a>',
    );
    expect(el.querySelector('span.x')!.textContent).toBe('a');
    expect(
      [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    ).toEqual(['https://example.com', '#top']);
  });
});

describe('radio groups in passages and dialogs (#396)', () => {
  const RADIOS = '{radiobutton $choice "a" "A"}{radiobutton $choice "b" "B"}';
  beforeEach(() => setup({ choice: 'a' }, [makePassage(2, 'Picker', RADIOS)]));

  /** The checked state of the radio inputs below `root`. */
  const checked = (root: ParentNode) =>
    [...root.querySelectorAll<HTMLInputElement>('input[type=radio]')].map(
      (r) => r.checked,
    );

  it('keeps the passage selection when a dialog binds the same variable', () => {
    const el = renderPassage(`${RADIOS}{dialog "Open"}Picker{/dialog}`);
    expect(checked(el)).toEqual([true, false]);

    act(() => el.querySelector<HTMLButtonElement>('button')!.click());
    const panel = el.querySelector('.dialog-panel')!;
    expect(checked(panel)).toEqual([true, false]);
    const passageRadios = [
      ...el.querySelectorAll<HTMLInputElement>('.passage > * input'),
    ].filter((r) => !panel.contains(r));
    expect(passageRadios.map((r) => r.checked)).toEqual([true, false]);
    // The dialog's group is its own
    expect(passageRadios[0]!.name).not.toBe(
      panel.querySelector<HTMLInputElement>('input')!.name,
    );

    act(() => el.querySelector<HTMLButtonElement>('.dialog-close')!.click());
    expect(el.querySelector('.dialog-panel')).toBeNull();
    expect(checked(el)).toEqual([true, false]);
    expect(useStoryStore.getState().variables.choice).toBe('a');
  });

  it('groups the radiobuttons of a variable within one view', () => {
    const el = renderPassage(RADIOS);
    const [a, b] = el.querySelectorAll<HTMLInputElement>('input');
    expect(a!.name).toBe(b!.name);
    act(() => b!.click());
    expect(useStoryStore.getState().variables.choice).toBe('b');
    expect(checked(el)).toEqual([false, true]);
  });
});

describe('restart with a dialog of a persistent view open (#397)', () => {
  // Stands for the story interface, which a restart does not remount
  const iface = makePassage(
    10,
    'StoryInterface',
    '{dialog "Options"}Options{/dialog}',
  );
  let container: HTMLElement;

  beforeEach(() => {
    setup({ n: 0 }, [
      iface,
      makePassage(
        11,
        'Options',
        '{button "Reset"}{do}Story.restart(){/do}{/button}',
      ),
      makePassage(12, 'Host', 'Host content'),
    ]);
    container = document.createElement('div');
    document.body.appendChild(container);
    act(() => {
      render(
        <>
          <TriggerDialogHost />
          <Passage passage={iface} />
        </>,
        container,
      );
    });
  });

  const panels = () => container.querySelectorAll('.dialog-panel');
  const click = (selector: string) =>
    act(() => container.querySelector<HTMLElement>(selector)!.click());

  it('closes it, as it closes dialogs opened through the Story API', () => {
    click('button.macro-dialog');
    expect(panels()).toHaveLength(1);
    act(() => window.Story.openDialog('Host'));
    expect(panels()).toHaveLength(2);

    click('.dialog-panel button.macro-button');
    expect(panels()).toHaveLength(0);
    expect(window.Story.isDialogOpen()).toBe(false);
    expect(document.querySelector('.dialog-panel')).toBeNull();

    // It opens again on request
    click('button.macro-dialog');
    expect(panels()).toHaveLength(1);
    act(() => render(null, container));
    container.remove();
  });
});
