// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import {
  getActions,
  clearActions,
  resetIdCounters,
} from '../../src/action-registry';
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

  describe('PassageLink', () => {
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
      renderPassage('{cycle $weapon}{option sword}{option axe}{/cycle}');
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
});
