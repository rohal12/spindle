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
    act(() => {
      useStoryStore.setState((s) => {
        delete s.temporary.double;
      });
    });
    act(() => {
      useStoryStore.getState().setVariable('value', 5);
    });
    act(() => {
      useStoryStore.getState().setVariable('value', 5);
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
