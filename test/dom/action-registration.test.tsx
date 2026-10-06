// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import {
  getActions,
  clearActions,
  resetIdCounters,
} from '../../src/action-registry';
import { on } from '../../src/event-emitter';
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
  render(<Passage passage={passage} />, container);
  return container;
}

describe('action registration', () => {
  beforeEach(() => {
    clearActions();
    resetIdCounters();
    const store = useStoryStore.getState();
    store.init(
      makeStoryData([
        makePassage(1, 'Start', 'Start'),
        makePassage(2, 'Forest', 'The forest'),
        makePassage(3, 'Cave', 'The cave'),
      ]),
    );
  });

  describe('wiki-link (desugared to {link})', () => {
    it('registers a link action on mount', () => {
      renderPassage('[[Go to Forest|Forest]]');
      const actions = getActions();
      const linkAction = actions.find((a) => a.type === 'link');
      expect(linkAction).toBeDefined();
      expect(linkAction!.id).toBe('link:Forest');
      expect(linkAction!.target).toBe('Forest');
    });

    it('unregisters on unmount', () => {
      const container = document.createElement('div');
      const passage = makePassage(1, 'Test', '[[Forest]]');
      render(<Passage passage={passage} />, container);
      expect(getActions().some((a) => a.type === 'link')).toBe(true);

      render(null, container);
      expect(getActions().some((a) => a.id === 'link:Forest')).toBe(false);
    });
  });

  // Issue #200: quotes in bracket-link values ended the synthesized args
  describe('wiki-link values containing quotes', () => {
    beforeEach(() => {
      useStoryStore
        .getState()
        .init(
          makeStoryData([
            makePassage(1, 'Start', 'Start'),
            makePassage(2, 'B', 'Second passage'),
            makePassage(3, 'The "End"', 'Fin'),
            makePassage(4, 'C:\\dir\\', 'Path'),
          ]),
        );
    });

    function linkFor(markup: string) {
      const el = renderPassage(markup);
      const action = getActions().find((a) => a.type === 'link');
      return { el, action };
    }

    it.each([
      ['[[Say "hello"->B]]', 'Say "hello"', 'B'],
      ['[[Say "hello"|B]]', 'Say "hello"', 'B'],
      ['[[B<-Say "hello"]]', 'Say "hello"', 'B'],
      ['[[Go->The "End"]]', 'Go', 'The "End"'],
      ['[[Go|The "End"]]', 'Go', 'The "End"'],
      ['[[The "End"<-Go]]', 'Go', 'The "End"'],
      ['[[The "End"]]', 'The "End"', 'The "End"'],
      ['[["Quoted" \'mixed\'->The "End"]]', '"Quoted" \'mixed\'', 'The "End"'],
      ['[[Path \\ "x\\"->C:\\dir\\]]', 'Path \\ "x\\"', 'C:\\dir\\'],
    ])('%s keeps label and target (#200)', (markup, label, target) => {
      const { el, action } = linkFor(markup);
      expect(el.querySelector('a.macro-link')!.textContent).toBe(label);
      expect(action!.label).toBe(label);
      expect(action!.target).toBe(target);
    });

    it('navigates to the target when clicked (#200)', () => {
      const { el } = linkFor('[[Say "hello"->B]]');
      (el.querySelector('a.macro-link') as HTMLElement).click();
      expect(useStoryStore.getState().currentPassage).toBe('B');
    });
  });

  describe('multiple links to same passage', () => {
    it('generates unique IDs with suffix', () => {
      renderPassage('[[Go|Forest]] [[Also go|Forest]]');
      const actions = getActions().filter((a) => a.type === 'link');
      const ids = actions.map((a) => a.id);
      expect(ids).toContain('link:Forest');
      expect(ids).toContain('link:Forest:2');
    });
  });

  describe('author #id override', () => {
    it('uses author-provided id', () => {
      renderPassage('[[#mylink Go|Forest]]');
      const actions = getActions();
      const linkAction = actions.find((a) => a.id === 'mylink');
      expect(linkAction).toBeDefined();
      expect(linkAction!.target).toBe('Forest');
    });
  });

  describe('Cycle', () => {
    it('registers with options and current value', () => {
      useStoryStore.getState().setVariable('weapon', 'sword');
      renderPassage('{cycle $weapon}{option "sword"}{option "axe"}{/cycle}');
      const actions = getActions();
      const cycleAction = actions.find((a) => a.type === 'cycle');
      expect(cycleAction).toBeDefined();
      expect(cycleAction!.variable).toBe('weapon');
      expect(cycleAction!.options).toEqual(['sword', 'axe']);
      expect(cycleAction!.value).toBe('sword');
    });
  });

  describe('Checkbox', () => {
    it('registers with variable and label', () => {
      useStoryStore.getState().setVariable('agree', false);
      renderPassage('{checkbox $agree "I agree"}');
      const actions = getActions();
      const cb = actions.find((a) => a.type === 'checkbox');
      expect(cb).toBeDefined();
      expect(cb!.variable).toBe('agree');
      expect(cb!.label).toBe('I agree');
      expect(cb!.value).toBe(false);
    });
  });

  describe('Textbox', () => {
    it('registers with variable and placeholder label', () => {
      useStoryStore.getState().setVariable('name', '');
      renderPassage('{textbox $name "Enter name"}');
      const actions = getActions();
      const tb = actions.find((a) => a.type === 'textbox');
      expect(tb).toBeDefined();
      expect(tb!.variable).toBe('name');
      expect(tb!.label).toBe('Enter name');
    });
  });
  // #233: navigation resets the ID counters while controls outside the
  // passage (StoryInterface) stay mounted
  describe('controls that outlive a navigation', () => {
    const containers: HTMLElement[] = [];
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
      for (const c of containers.splice(0)) act(() => render(null, c));
      warn.mockRestore();
    });
    function mount(content: string): HTMLElement {
      const container = document.createElement('div');
      containers.push(container);
      act(() => {
        render(
          <Passage passage={makePassage(1, 'Test', content)} />,
          container,
        );
      });
      return container;
    }
    const forestIds = () =>
      getActions()
        .filter((a) => a.target === 'Forest')
        .map((a) => a.id)
        .sort();

    it('a passage control mounted after the reset gets an unused ID', () => {
      mount('[[Forest]]'); // persistent
      resetIdCounters();
      mount('[[Forest]]');
      expect(forestIds()).toEqual(['link:Forest', 'link:Forest:2']);
    });

    it("unmounting the passage control keeps the persistent one's registration", () => {
      mount('[[Forest]]'); // persistent
      resetIdCounters();
      const passage = mount('[[Forest]]');
      act(() => render(null, passage));
      expect(forestIds()).toEqual(['link:Forest']);
    });

    it('unmounting one of two controls sharing an author ID keeps the other', () => {
      const first = mount('[[#shared Go|Forest]]');
      mount('[[#shared Also go|Forest]]');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(getActions().filter((a) => a.id === 'shared')).toHaveLength(1);

      act(() => render(null, first));
      expect(getActions().find((a) => a.id === 'shared')?.label).toBe(
        'Also go',
      );
    });
  });

  describe('when an action changes', () => {
    // Components rendered by earlier tests stay mounted, so these tests use
    // their own variable, only look at the actions they render and unmount
    // what they render.
    const containers: HTMLElement[] = [];
    afterEach(() => {
      for (const c of containers.splice(0)) act(() => render(null, c));
    });
    function mount(content: string): HTMLElement {
      const container = document.createElement('div');
      containers.push(container);
      act(() => {
        render(
          <Passage passage={makePassage(1, 'Test', content)} />,
          container,
        );
      });
      return container;
    }
    const own = () =>
      getActions().filter(
        (a) => a.variable === 'consent' || a.label === 'Proceed',
      );

    it('updates it in place, keeping its position', () => {
      useStoryStore.getState().setVariable('consent', false);
      mount('{checkbox $consent "I agree"}{button "Proceed"}{/button}');
      const before = own().map((a) => a.id);

      act(() => useStoryStore.getState().setVariable('consent', true));

      expect(own().map((a) => a.id)).toEqual(before);
      expect(own()[0]!.value).toBe(true);
    });

    it('notifies listeners once', () => {
      useStoryStore.getState().setVariable('consent', false);
      mount('{checkbox $consent "I agree"}');
      let count = 0;
      const off = on('actionsChanged', () => count++);

      act(() => useStoryStore.getState().setVariable('consent', true));
      off();

      expect(count).toBe(1);
    });

    it('still unregisters on unmount after an update', () => {
      useStoryStore.getState().setVariable('consent', false);
      const container = mount('{checkbox $consent "I agree"}');
      act(() => useStoryStore.getState().setVariable('consent', true));
      act(() => render(null, container));
      expect(own()).toEqual([]);
    });
  });
});
