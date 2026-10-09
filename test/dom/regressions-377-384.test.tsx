// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { parseStoryVariables } from '../../src/story-variables';
import { registerClass } from '../../src/class-registry';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function setup(vars: Record<string, unknown>): void {
  const passages = [makePassage(1, 'Start', 'Start')];
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

describe('null story-variable defaults (#378)', () => {
  it('accepts null at the root and nested', () => {
    const schema = parseStoryVariables(
      '$selected = null\n$player = { name: "Hero", equipment: null }',
    );
    expect(schema.get('selected')).toMatchObject({
      type: 'null',
      default: null,
    });
    expect(schema.get('player')!.fields!.get('equipment')!.type).toBe('null');
  });
});

describe('details and style markup (#381, #382)', () => {
  beforeEach(() => setup({}));

  it('keeps summary a direct child of details', () => {
    const el = renderPassage(
      '<details id="hint"><summary id="s">Read hint</summary>Secret clue</details>',
    );
    const summary = el.querySelector('#hint > summary');
    expect(summary).not.toBeNull();
    expect(summary!.textContent).toBe('Read hint');
    expect(summary!.querySelector('p')).toBeNull();
    expect(el.querySelector('#hint')!.textContent).toContain('Secret clue');
  });

  it('keeps style contents as CSS text', () => {
    const el = renderPassage(
      '<style id="st">#thing { color: red; }</style>\n<div id="thing">x</div>',
    );
    const style = el.querySelector('#st')!;
    expect(style.querySelector('p')).toBeNull();
    expect(style.textContent).toBe('#thing { color: red; }');
  });
});

describe('{type} without characters (#384)', () => {
  beforeEach(() => setup({}));

  it('completes and shows content that holds no text', async () => {
    const el = renderPassage(
      '{type 1ms}<svg id="image" width="5" height="5"></svg>{/type}',
    );
    await act(async () => {});
    const inner = el.querySelector('.macro-type-inner') as HTMLElement;
    expect(inner.style.visibility).toBe('visible');
    expect(el.querySelector('.macro-type-done')).not.toBeNull();
  });
});

describe('{computed} target restored after a namespace reset (#379)', () => {
  beforeEach(() => setup({ value: 5 }));

  it('writes an unchanged result again once the temporary is gone', () => {
    renderPassage('{computed _double = $value * 2}');
    expect(useStoryStore.getState().temporary.double).toBe(10);
    // What a navigation does to the temporary namespace
    act(() => {
      useStoryStore.setState((s) => {
        delete s.temporary.double;
        s.navigationId++;
      });
    });
    expect(useStoryStore.getState().temporary.double).toBe(10);
  });
});

describe('registered class instances in history (#377)', () => {
  class Player {
    hp = 100;
    damage(n: number) {
      this.hp -= n;
    }
  }

  it('Story.get() hands out a copy, not the live instance', () => {
    registerClass('Player377', Player);
    setup({ player: new Player() });
    const got = window.Story.get('player') as Player;
    got.damage(20);
    expect((useStoryStore.getState().variables.player as Player).hp).toBe(100);
  });
});

describe('values inside a Map or Set read through Story.get() (#388)', () => {
  class Hero {
    hp = 100;
    damage(n: number) {
      this.hp -= n;
    }
  }
  beforeEach(() => registerClass('Hero388', Hero));

  const stored = () => useStoryStore.getState().variables.party;

  it('hands out a copy of a class instance in a Map', () => {
    setup({ party: new Map([['hero', new Hero()]]) });
    const got = window.Story.get('party') as Map<string, Hero>;
    got.get('hero')!.damage(20);
    expect((stored() as Map<string, Hero>).get('hero')!.hp).toBe(100);
  });

  it('hands out a copy of a class instance used as a Map key', () => {
    setup({ party: new Map([[new Hero(), 'hero']]) });
    const got = window.Story.get('party') as Map<Hero, string>;
    [...got.keys()][0]!.damage(20);
    expect([...(stored() as Map<Hero, string>).keys()][0]!.hp).toBe(100);
  });

  it('hands out a copy of a class instance in a Set', () => {
    setup({ party: new Set([new Hero()]) });
    const got = window.Story.get('party') as Set<Hero>;
    [...got][0]!.damage(20);
    expect([...(stored() as Set<Hero>)][0]!.hp).toBe(100);
  });

  it('hands out a copy of a Date in a Map', () => {
    setup({ party: new Map([['when', new Date(2000, 0, 1)]]) });
    const got = window.Story.get('party') as Map<string, Date>;
    got.get('when')!.setFullYear(2020);
    const when = (stored() as Map<string, Date>).get('when')!;
    expect(when.getFullYear()).toBe(2000);
  });

  it('still returns a plain frozen collection as it is', () => {
    setup({ party: new Map([['hero', { hp: 100 }]]) });
    expect(window.Story.get('party')).toBe(stored());
  });
});
