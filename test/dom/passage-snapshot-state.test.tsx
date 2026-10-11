// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { useStoryStore } from '../../src/store';
import { parseMarkup } from '../../src/markup/parse';
import { renderNodes } from '../../src/markup/render';
import type { StoryData, Passage as PassageData } from '../../src/parser';

import '../../src/components/macros/PassageDisplay';

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

// jsdom/happy-dom have no canvas bitmap: record what is drawn where instead
type Draw = { target: HTMLCanvasElement; source: unknown; args: number[] };

describe('outgoing passage snapshots keep what cloneNode drops (#512)', () => {
  let container: HTMLElement;
  let draws: Draw[];

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    draws = [];
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement) {
        const target = this;
        return {
          drawImage: (source: unknown, ...args: number[]) =>
            draws.push({ target, source, args }),
        };
      } as never,
    );
  });

  afterEach(() => {
    act(() => {
      render(null, container);
    });
    document.body.removeChild(container);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Show a `Start` passage with this markup. */
  function leave(start: string): void {
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(1, 'Start', start),
          makePassage(2, 'Next', 'Done'),
        ]),
      );
    useStoryStore
      .getState()
      .setTransition({ type: 'fade-through', duration: 300 });
    act(() => {
      render(<>{renderNodes(parseMarkup('{passage}'))}</>, container);
    });
  }

  /** Navigate to `Next` and return the outgoing snapshot. */
  function navigate(): HTMLElement {
    act(() => {
      useStoryStore.getState().navigate('Next');
    });
    const snapshot = container.querySelector('.passage-snapshot');
    expect(snapshot).not.toBeNull();
    return snapshot as HTMLElement;
  }

  it('copies each canvas bitmap into the matching cloned canvas', () => {
    leave(
      '<canvas id="a" width="100" height="50"></canvas><div><canvas width="7" height="9"></canvas></div>',
    );
    const live = [...container.querySelectorAll('.passage canvas')];
    expect(live).toHaveLength(2);

    const snapshot = navigate();
    const cloned = [...snapshot.querySelectorAll('canvas')];
    expect(cloned).toHaveLength(2);
    expect(draws).toHaveLength(2);
    draws.forEach((draw, i) => {
      expect(draw.target).toBe(cloned[i]);
      expect(draw.source).toBe(live[i]);
      expect(draw.args).toEqual([0, 0]);
    });
  });

  it('leaves an empty canvas alone', () => {
    leave('<canvas width="0" height="0"></canvas>');
    const snapshot = navigate();
    expect(snapshot.querySelector('canvas')).not.toBeNull();
    expect(draws).toEqual([]);
  });

  it('survives a canvas that cannot be drawn from', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => {
        throw new Error('no context');
      },
    );
    leave('<canvas width="10" height="10"></canvas>');
    expect(navigate().querySelector('canvas')).not.toBeNull();
  });

  it('keeps the values of form controls', () => {
    leave(
      '<input type="text" id="t"><input type="checkbox" id="c"><textarea id="x"></textarea><select id="s"><option value="a">a</option><option value="b">b</option></select>',
    );
    const q = <T extends Element>(selector: string) =>
      container.querySelector(`.passage ${selector}`) as unknown as T;
    q<HTMLInputElement>('#t').value = 'typed';
    q<HTMLInputElement>('#c').checked = true;
    q<HTMLTextAreaElement>('#x').value = 'long text';
    q<HTMLSelectElement>('#s').value = 'b';

    const snapshot = navigate();
    const s = <T extends Element>(selector: string) =>
      snapshot.querySelector(selector) as unknown as T;
    expect(s<HTMLInputElement>('input[type=text]').value).toBe('typed');
    expect(s<HTMLInputElement>('input[type=checkbox]').checked).toBe(true);
    expect(s<HTMLTextAreaElement>('textarea').value).toBe('long text');
    expect(s<HTMLSelectElement>('select').value).toBe('b');
  });
});
