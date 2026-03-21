// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { PassageDialog } from '../../src/components/PassageDialog';
import { useStoryStore } from '../../src/store';
import type { Passage as PassageData, StoryData } from '../../src/parser';

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

describe('error display with non-Error thrown values', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'hello')]));
  });

  describe('Passage', () => {
    it('displays string error message when a string is thrown', async () => {
      // Mock tokenize to throw a string
      const tokenize = await import('../../src/markup/tokenizer');
      const spy = vi.spyOn(tokenize, 'tokenize').mockImplementation(() => {
        throw 'raw string error';
      });

      const container = document.createElement('div');
      render(
        <Passage passage={makePassage(1, 'Broken', 'bad content')} />,
        container,
      );

      const errorDiv = container.querySelector('.error');
      expect(errorDiv).not.toBeNull();
      // Should show the actual string, not "undefined"
      expect(errorDiv!.textContent).toContain('raw string error');
      expect(errorDiv!.textContent).not.toContain('undefined');

      spy.mockRestore();
    });
  });

  describe('PassageDialog', () => {
    it('displays string error message when a string is thrown', async () => {
      const tokenize = await import('../../src/markup/tokenizer');
      const spy = vi.spyOn(tokenize, 'tokenize').mockImplementation(() => {
        throw 'dialog parse error';
      });

      const container = document.createElement('div');
      render(
        <PassageDialog
          fallbackMarkup="bad markup"
          onClose={() => {}}
        />,
        container,
      );

      const errorDiv = container.querySelector('.error');
      expect(errorDiv).not.toBeNull();
      expect(errorDiv!.textContent).toContain('dialog parse error');
      expect(errorDiv!.textContent).not.toContain('undefined');

      spy.mockRestore();
    });
  });
});
