// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { settings } from '../../src/settings';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[]): StoryData {
  return {
    name: 'Test Story',
    startNode: 1,
    ifid: 'settings-description-test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

function renderControls(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(
      <Passage passage={makePassage(1, 'Test', '{settings-controls}')} />,
      container,
    );
  });
  return container;
}

describe('{settings-controls} descriptions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    settings.getDefinitions().clear();
    useStoryStore.getState().init(makeStoryData([makePassage(1, 'Test', '')]));
  });

  it('shows a description under its toggle and links it to the control', () => {
    settings.addToggle('hints', {
      label: 'Show hints',
      description: 'Hints appear after a while.',
      default: true,
    });
    const el = renderControls();
    const desc = el.querySelector<HTMLElement>('.settings-description')!;
    expect(desc.textContent).toBe('Hints appear after a while.');
    expect(desc.id).not.toBe('');
    const input = el.querySelector('.settings-row input')!;
    expect(input.getAttribute('aria-describedby')).toBe(desc.id);
    expect(desc.closest('.settings-item')).toBe(
      input.closest('.settings-item'),
    );
  });

  it('links the description to a list and a range', () => {
    settings.addList('size', {
      label: 'Size',
      description: 'How big the text is.',
      options: ['S', 'L'],
      default: 'S',
    });
    settings.addRange('volume', {
      label: 'Volume',
      description: 'How loud it is.',
      min: 0,
      max: 10,
      step: 1,
      default: 5,
    });
    const el = renderControls();
    const descs = el.querySelectorAll<HTMLElement>('.settings-description');
    expect(descs).toHaveLength(2);
    expect(descs[0]!.textContent).toBe('How big the text is.');
    expect(descs[1]!.textContent).toBe('How loud it is.');
    expect(descs[0]!.id).not.toBe(descs[1]!.id);
    expect(el.querySelector('select')!.getAttribute('aria-describedby')).toBe(
      descs[0]!.id,
    );
    expect(
      el.querySelector('input[type=range]')!.getAttribute('aria-describedby'),
    ).toBe(descs[1]!.id);
  });

  it('adds no element and no attribute without a description', () => {
    settings.addToggle('plain', { label: 'Plain', default: false });
    settings.addToggle('empty', {
      label: 'Empty',
      description: '',
      default: false,
    });
    settings.addToggle('blank', {
      label: 'Blank',
      description: '  ',
      default: false,
    });
    const el = renderControls();
    expect(el.querySelector('.settings-description')).toBeNull();
    expect(el.querySelector('.settings-item')).toBeNull();
    expect(
      el.querySelectorAll('.settings-controls > .settings-row'),
    ).toHaveLength(3);
    for (const input of el.querySelectorAll('input')) {
      expect(input.hasAttribute('aria-describedby')).toBe(false);
    }
  });

  it('shows markup-looking text as text', () => {
    const text = '<b>Bold</b> *star* {do}x{/do} &amp; <script>1</script>';
    settings.addToggle('odd', {
      label: 'Odd',
      description: text,
      default: false,
    });
    const el = renderControls();
    const desc = el.querySelector('.settings-description')!;
    expect(desc.textContent).toBe(text);
    expect(desc.children).toHaveLength(0);
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('script')).toBeNull();
  });

  it('keeps the control working', () => {
    settings.addToggle('hints', {
      label: 'Show hints',
      description: 'Text',
      default: false,
    });
    const el = renderControls();
    const input = el.querySelector<HTMLInputElement>('.settings-row input')!;
    act(() => {
      input.checked = true;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(settings.getToggle('hints')).toBe(true);
  });
});
