// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

function renderPassage(content: string): HTMLElement {
  const passage = makePassage(1, 'Test', content);
  const container = document.createElement('div');
  act(() => {
    render(<Passage passage={passage} />, container);
  });
  return container;
}

class Player {
  hp = 100;
  name = 'Ada';
  stats = { str: 10 };
  inventory: string[] = ['sword'];
  isAlive(): boolean {
    return this.hp > 0;
  }
}

const Story = () => (globalThis as Record<string, any>).Story;

describe('dot-path writes into registered class instances (#213)', () => {
  beforeEach(() => {
    registerClass('Player', Player);
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(1, 'Start', ''),
          makePassage(2, 'Room', ''),
        ]),
      );
    installStoryAPI();
    // As StoryInit would: create the instance, then record the start moment
    Story().set('player', new Player());
    recordStoryInitState();
  });

  afterEach(() => {
    clearRegistry();
  });

  function player(): Player {
    return useStoryStore.getState().variables.player as Player;
  }

  it('Story.set replaces the instance instead of mutating it in place', () => {
    const before = player();
    Story().set('player.hp', 50);
    const after = player();
    expect(after).not.toBe(before);
    expect(after).toBeInstanceOf(Player);
    expect(after.hp).toBe(50);
    expect(after.isAlive()).toBe(true);
    expect(before.hp).toBe(100);
  });

  it('Story.set copies nested objects inside the instance on write', () => {
    const before = player();
    Story().set('player.stats.str', 12);
    Story().set('player.inventory.0', 'axe');
    expect(player().stats.str).toBe(12);
    expect(player().inventory).toEqual(['axe']);
    expect(before.stats.str).toBe(10);
    expect(before.inventory).toEqual(['sword']);
  });

  it('Story.set on a transient instance replaces it', () => {
    useStoryStore.getState().setTransient('npc', new Player());
    const before = useStoryStore.getState().transient.npc as Player;
    Story().set('%npc.hp', 5);
    const after = useStoryStore.getState().transient.npc as Player;
    expect(after).not.toBe(before);
    expect(after).toBeInstanceOf(Player);
    expect(after.hp).toBe(5);
    expect(before.hp).toBe(100);
  });

  it('notifies variableChanged watchers', () => {
    const cb = vi.fn();
    const unsub = Story().on('variableChanged', cb);
    Story().set('player.hp', 50);
    unsub();
    expect(cb).toHaveBeenCalledTimes(1);
    const changed = cb.mock.calls[0]![0] as Record<
      string,
      { from: Player; to: Player }
    >;
    expect(changed.player!.from.hp).toBe(100);
    expect(changed.player!.to.hp).toBe(50);
  });

  it('updates a rendered display', () => {
    const el = renderPassage('HP {$player.hp}');
    expect(el.textContent).toContain('HP 100');
    act(() => {
      Story().set('player.hp', 50);
    });
    expect(el.textContent).toContain('HP 50');
  });

  it('keeps the history moment intact so back() restores it', () => {
    useStoryStore.getState().navigate('Room');
    Story().set('player.hp', 50);
    expect(player().hp).toBe(50);
    Story().back();
    expect(player().hp).toBe(100);
    expect(player()).toBeInstanceOf(Player);
  });

  it('a bound input writes a new instance and leaves history intact', () => {
    useStoryStore.getState().navigate('Room');
    const before = player();
    const el = renderPassage('{textbox $player.name "Name"} {$player.name}');
    const input = el.querySelector('input[type="text"]') as HTMLInputElement;
    act(() => {
      const event = new Event('input', { bubbles: true });
      Object.defineProperty(event, 'target', { value: { value: 'Zara' } });
      input.dispatchEvent(event);
    });
    expect(player()).not.toBe(before);
    expect(player()).toBeInstanceOf(Player);
    expect(player().name).toBe('Zara');
    expect(before.name).toBe('Ada');
    expect(el.textContent).toContain('Zara');
    Story().back();
    expect(player().name).toBe('Ada');
  });

  it('a bound numberbox writes into a nested object of the instance', () => {
    const before = player();
    const el = renderPassage('{numberbox $player.stats.str}');
    const input = el.querySelector('input[type="number"]') as HTMLInputElement;
    expect(input.value).toBe('10');
    act(() => {
      input.value = '15';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(player().stats.str).toBe(15);
    expect(before.stats.str).toBe(10);
  });
});
