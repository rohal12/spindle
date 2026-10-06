// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
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

/**
 * Macros that take a literal quoted label or value accept the same escapes
 * as {link} (#200): \" or \' for a quote and \\ for a backslash.
 */
describe('escapes in quoted label arguments', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  describe('{button}', () => {
    it('unescapes quotes in the label', () => {
      const el = renderPassage(String.raw`{button "Say \"hi\""}{/button}`);
      expect(el.querySelector('button')!.textContent).toBe('Say "hi"');
    });

    it('unescapes a trailing escaped backslash', () => {
      const el = renderPassage(String.raw`{button "C:\\"}{/button}`);
      expect(el.querySelector('button')!.textContent).toBe('C:\\');
    });

    it('keeps an unquoted label as written', () => {
      const el = renderPassage('{button Go now}{/button}');
      expect(el.querySelector('button')!.textContent).toBe('Go now');
    });
  });

  describe('{dialog}', () => {
    it('unescapes quotes in the label', () => {
      const el = renderPassage(
        String.raw`{dialog "Say \"hi\"" noclose}Help{/dialog}`,
      );
      expect(el.querySelector('button')!.textContent).toBe('Say "hi"');
    });
  });

  describe('{checkbox}', () => {
    it('unescapes quotes in the label', () => {
      const el = renderPassage(String.raw`{checkbox $agree "I \"agree\""}`);
      expect(el.querySelector('label')!.textContent!.trim()).toBe('I "agree"');
    });

    it('keeps an unquoted label as written', () => {
      const el = renderPassage('{checkbox $agree I agree}');
      expect(el.querySelector('label')!.textContent!.trim()).toBe('I agree');
    });
  });

  describe('{radiobutton}', () => {
    it('unescapes quotes in the value and label', () => {
      useStoryStore.getState().setVariable('color', 'a "b"');
      const el = renderPassage(
        String.raw`{radiobutton $color "a \"b\"" "Label \"B\""}`,
      );
      expect(el.querySelector('label')!.textContent!.trim()).toBe('Label "B"');
      expect((el.querySelector('input') as HTMLInputElement).checked).toBe(
        true,
      );
    });

    it('does not end the value at the other quote kind', () => {
      useStoryStore.getState().setVariable('q', 'He said " hi');
      const el = renderPassage(`{radiobutton $q 'He said " hi' 'Quote'}`);
      expect(el.querySelector('label')!.textContent!.trim()).toBe('Quote');
      expect((el.querySelector('input') as HTMLInputElement).checked).toBe(
        true,
      );
    });

    it('strips the quotes from a value given without a label', () => {
      useStoryStore.getState().setVariable('color', 'red');
      const el = renderPassage('{radiobutton $color "red"}');
      expect((el.querySelector('input') as HTMLInputElement).checked).toBe(
        true,
      );
    });

    it('keeps the unquoted fallback', () => {
      useStoryStore.getState().setVariable('color', 'red');
      const el = renderPassage('{radiobutton $color red Red}');
      expect(el.querySelector('label')!.textContent!.trim()).toBe('Red');
      expect((el.querySelector('input') as HTMLInputElement).checked).toBe(
        true,
      );
    });
  });

  describe('{textbox}', () => {
    it('unescapes quotes in the placeholder', () => {
      const el = renderPassage(String.raw`{textbox $name "Say \"hi\""}`);
      expect(el.querySelector('input')!.getAttribute('placeholder')).toBe(
        'Say "hi"',
      );
    });
  });
});
