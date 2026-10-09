// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore, recordStoryInitState } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { registerClass, clearRegistry } from '../../src/class-registry';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import '../../src/components/macros/PassageDisplay';
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

const mounted: HTMLElement[] = [];

function renderPassage(content: string): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  mounted.push(container);
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  return container;
}

const Story = () => window.Story;

class Inventory extends Map<string, number> {}
class GameDate extends Date {}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    act(() => render(null, container));
    container.remove();
  }
  clearRegistry();
});

describe('alias assignment through own fields of built-in subclasses (#412)', () => {
  beforeEach(() => {
    registerClass('Inventory', Inventory);
    registerClass('GameDate', GameDate);
    setup({ state: { bag: null, item: { id: 1 }, alias: null } });
  });

  function init(kind: 'map' | 'date' | 'plain') {
    const bag: any =
      kind === 'map' ? new Inventory() : kind === 'date' ? new GameDate(0) : {};
    bag[kind === 'date' ? 'event' : 'selected'] = { id: 1 };
    act(() => Story().set('state', { bag, item: { id: 1 }, alias: null }));
  }

  it('assigning an equal existing object to a Map field keeps its identity', () => {
    init('map');
    const el = renderPassage(
      '{button "Select"}{set $state.bag.selected = $state.item}{/button}Same: {$state.bag.selected === $state.item}',
    );
    expect(el.textContent).toContain('Same: false');
    act(() => el.querySelector('button')!.click());
    expect(el.textContent).toContain('Same: true');
  });

  it('plain objects behave the same (control)', () => {
    init('plain');
    const el = renderPassage(
      '{button "Select"}{set $state.bag.selected = $state.item}{/button}Same: {$state.bag.selected === $state.item}',
    );
    act(() => el.querySelector('button')!.click());
    expect(el.textContent).toContain('Same: true');
  });

  it('assigning a Map field to another variable shares the object', () => {
    init('map');
    renderPassage('{set $state.alias = $state.bag.selected}');
    const state = Story().get('state') as any;
    expect(state.alias).toBe(state.bag.selected);
  });

  it('does the same for a Date subclass field', () => {
    init('date');
    renderPassage('{set $state.alias = $state.bag.event}');
    const state = Story().get('state') as any;
    expect(state.bag).toBeInstanceOf(GameDate);
    expect(state.alias).toBe(state.bag.event);
  });
});

describe('input bindings reject non-story sigils (#414)', () => {
  beforeEach(() => setup({ name: 'x' }));

  it.each([
    ['_name', 'temporary variables'],
    ['@name', 'locals'],
    ['%name', 'transient variables'],
  ])('refuses %s', (binding, kind) => {
    const el = renderPassage(`{set _name = "Ada"}{textbox ${binding}}`);
    expect(el.querySelector('input')).toBeNull();
    expect(el.querySelector('.error')?.textContent).toContain(kind);
    expect(Story().get('_name')).toBeUndefined();
  });

  it('still binds $ and nested $object.field', () => {
    setup({ name: 'x', obj: { a: '' } });
    const el = renderPassage('{textbox $name}{textbox $obj.a}');
    expect(el.querySelectorAll('input[type="text"]')).toHaveLength(2);
    expect(el.querySelector('.error')).toBeNull();
  });
});

describe('a {for} button body that edits its item (#411)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setup({ party: [{ hp: 0 }], done: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it('keeps the button and finishes its timer', () => {
    const el = renderPassage(
      '{for @p, @i of $party}{button "Heal"}{set $party[@i].hp += 1}{timed 100ms}{set $done += 1}{/timed}{/button}{/for}Done: {$done}',
    );
    const button = el.querySelector('button')!;
    act(() => button.click());
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(Story().get('party')).toEqual([{ hp: 1 }]);
    expect(Story().get('done')).toBe(1);
    expect(button.isConnected).toBe(true);
  });
});

describe('timers of a passage that was left (#410)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setup({ n: 0 }, [
      makePassage(2, 'B', 'B'),
      makePassage(3, 'A', '{repeat 20ms}{set $n += 1}{/repeat}'),
      makePassage(4, 'T', '{timed 100ms}{set $n += 1}{/timed}'),
    ]);
  });
  afterEach(() => vi.useRealTimers());

  it.each(['A', 'T'])('%s stops writing once navigation happened', (name) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mounted.push(container);
    useStoryStore.getState().navigate(name);
    act(() => {
      render(<>{renderNodes(parseMarkup('{passage}'))}</>, container);
    });
    act(() => {
      vi.advanceTimersByTime(90);
    });
    // Navigation is in the store; the outgoing tree is still mounted
    useStoryStore.getState().navigate('B');
    const before = Story().get('n');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(Story().get('n')).toBe(before);
  });
});
