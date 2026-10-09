// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore, recordStoryInitState } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { registerClass, clearRegistry } from '../../src/class-registry';
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

class Bag extends Array<unknown> {
  constructor(public label = '') {
    super();
  }
}
class Inventory extends Map<string, number> {
  constructor(public label = '') {
    super();
  }
}
class GameDate extends Date {
  constructor(public era = '') {
    super(0);
  }
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    act(() => render(null, container));
    container.remove();
  }
  clearRegistry();
});

describe('{for} item keys of registered subclasses (#407)', () => {
  beforeEach(() => {
    registerClass('Bag', Bag);
    setup({ bags: [new Bag('Old label')] });
  });

  it('remounts an iteration whose item changed only its own fields', () => {
    const el = renderPassage(
      '{for @bag of $bags}{set @cached = @bag.label}[{@cached}|{@bag.label}]{/for}',
    );
    expect(el.textContent).toBe('[Old label|Old label]');
    act(() => Story().set('bags', [new Bag('New label')]));
    expect(el.textContent).toBe('[New label|New label]');
    expect(Story().get('bags.0')).toBeInstanceOf(Bag);
  });
});

describe('dot-path writes to own fields of registered built-in subclasses (#408)', () => {
  beforeEach(() => {
    registerClass('Bag', Bag);
    registerClass('Inventory', Inventory);
    registerClass('GameDate', GameDate);
    setup({}, [makePassage(2, 'Room', 'Room')]);
    const inventory = new Inventory('Initial');
    inventory.set('gold', 3);
    const bag = new Bag('Initial');
    bag.push('sword');
    Story().set({ inventory, bag, date: new GameDate('Initial') });
    recordStoryInitState();
  });

  it.each([
    ['inventory', Inventory],
    ['bag', Bag],
    ['date', GameDate],
  ] as const)('Story.set writes a field of a %s', (name, ctor) => {
    const field = name === 'date' ? 'era' : 'label';
    const before = useStoryStore.getState().variables[name] as object;
    useStoryStore.getState().navigate('Room');
    Story().set(`${name}.${field}`, 'API label');
    const after = Story().get(name) as Record<string, unknown>;
    expect(after).toBeInstanceOf(ctor);
    expect(after[field]).toBe('API label');
    // The instance history holds is left as it was
    expect((before as Record<string, unknown>)[field]).toBe('Initial');
    Story().back();
    expect((Story().get(name) as Record<string, unknown>)[field]).toBe(
      'Initial',
    );
  });

  it('keeps the contents of the instance it writes', () => {
    Story().set('inventory.label', 'x');
    Story().set('bag.label', 'y');
    const inventory = Story().get('inventory') as Inventory;
    expect([...inventory]).toEqual([['gold', 3]]);
    expect([...(Story().get('bag') as Bag)]).toEqual(['sword']);
    expect(Story().get('date.era')).toBe('Initial');
    expect(Date.prototype.getTime.call(Story().get('date') as GameDate)).toBe(
      0,
    );
  });

  it('a bound textbox writes the field', () => {
    const el = renderPassage(
      '{textbox $inventory.label "Label"}{$inventory.label}',
    );
    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => {
      input.value = 'Typed';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(Story().get('inventory.label')).toBe('Typed');
    expect(Story().get('inventory')).toBeInstanceOf(Inventory);
    expect(el.textContent).toContain('Typed');
  });

  it('still refuses a property on an unregistered Map or a plain array', () => {
    Story().set({ map: new Map(), list: [] });
    expect(() => Story().set('map.label', 'x')).toThrow(/on a Map/);
    expect(() => Story().set('list.label', 'x')).toThrow(/on an array/);
  });
});

describe('{for} body writes to its own item (#400)', () => {
  beforeEach(() => setup({ party: [{ hp: 0 }] }));

  it('runs the body once per item', () => {
    const el = renderPassage(
      '{for @member, @i of $party}{if @member.hp < 3}{set $party[@i].hp += 1}{/if}{/for}HP: {$party[0].hp}',
    );
    expect(Story().get('party')).toEqual([{ hp: 1 }]);
    expect(el.textContent).toBe('HP: 1');
  });

  it('runs an unbounded body once per item', () => {
    act(() => Story().set('party', [{ hp: 0 }, { hp: 10 }]));
    renderPassage('{for @member, @i of $party}{set $party[@i].hp += 1}{/for}');
    expect(Story().get('party')).toEqual([{ hp: 1 }, { hp: 11 }]);
  });

  it('writes through {do} once per item as well', () => {
    renderPassage('{for @m, @i of $party}{do}$party[@i].hp += 5{/do}{/for}');
    expect(Story().get('party')).toEqual([{ hp: 5 }]);
  });

  it('still remounts an iteration whose item is replaced from outside', () => {
    const el = renderPassage(
      '{for @member of $party}{set @copy = @member.hp}{@copy}{/for}',
    );
    expect(el.textContent).toBe('0');
    act(() => Story().set('party.0.hp', 7));
    expect(el.textContent).toBe('7');
    act(() => Story().set('party', [{ hp: 9 }]));
    expect(el.textContent).toBe('9');
  });

  it('still remounts when a button outside the loop changes the item', () => {
    const el = renderPassage(
      '{for @member of $party}{set @copy = @member.hp}{@copy}{/for}{button "Heal"}{set $party[0].hp = 4}{/button}',
    );
    expect(el.textContent).toContain('0');
    act(() => el.querySelector('button')!.click());
    expect(el.textContent).toContain('4');
  });
});
