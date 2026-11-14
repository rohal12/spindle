// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { useStoryStore } from '../../src/store';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import type { StoryData, Passage as PassageData } from '../../src/parser';

import '../../src/components/macros/PassageDisplay';

// WeakRef is newer than the ES2020 library the tests are checked against
declare class WeakRef<T extends object> {
  constructor(target: T);
  deref(): T | undefined;
}

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[]): StoryData {
  return {
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
}

/** A full garbage collection, with the chance for the weak refs to be cleared. */
async function collect(): Promise<void> {
  setFlagsFromString('--expose-gc');
  const gc = runInNewContext('gc') as () => void;
  for (let i = 0; i < 6; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    gc();
  }
}

describe('passages that were left are released', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    document.body.removeChild(container);
    useStoryStore.getState().setTransition(null);
  });

  it.each([
    ['inside an element', '<div class="scene">{passage}</div>', false],
    ['as the whole interface', '{passage}', false],
    [
      'with a header and a footer passage',
      '<div class="scene">{passage}</div>',
      true,
    ],
  ])(
    'lets go of each passage once the next is shown, %s',
    async (_, markup, special) => {
      useStoryStore
        .getState()
        .init(
          makeStoryData([
            makePassage(
              1,
              'Start',
              '<p>Start</p>\n{link "Again" "Start"}{/link}',
            ),
            ...(special
              ? [
                  makePassage(2, 'PassageHeader', '<p>Header</p>'),
                  makePassage(3, 'PassageFooter', '<p>Footer</p>'),
                ]
              : []),
          ]),
        );
      useStoryStore.getState().setTransition({ type: 'none' });
      act(() => {
        render(<>{renderNodes(parseMarkup(markup))}</>, container);
      });

      const seen: WeakRef<Element>[] = [];
      for (let i = 0; i < 12; i++) {
        act(() => {
          useStoryStore.getState().navigate('Start');
        });
        seen.push(new WeakRef(container.querySelector('.passage')!));
      }
      expect(container.querySelectorAll('.passage')).toHaveLength(1);

      await collect();
      // Only the passage on display and the one before it may be held
      expect(seen.slice(0, -2).map((ref) => ref.deref())).toEqual(
        Array(seen.length - 2).fill(undefined),
      );
    },
  );
});
