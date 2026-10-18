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

describe('outgoing passage snapshots keep what cloneNode drops (#512, #525, #536)', () => {
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

  it('keeps temporary variable displays in the outgoing snapshot (#593)', () => {
    leave(
      '{set _n = 7}<div class="values">{_n} vs {print _n} vs {_n + 0}</div>',
    );
    expect(container.querySelector('.values')?.textContent).toBe('7 vs 7 vs 7');
    const snapshot = navigate();
    expect(useStoryStore.getState().temporary.n).toBeUndefined();
    expect(snapshot.querySelector('.values')?.textContent).toBe('7 vs 7 vs 7');
  });

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

  it('keeps every selected option of a multiple select (#525)', () => {
    leave(
      '<select multiple><option>A</option><option>B</option><option>C</option><option>D</option></select>',
    );
    const live = container.querySelector('.passage select')!;
    const options = (live as HTMLSelectElement).options;
    options[1]!.selected = true;
    options[2]!.selected = true;

    const cloned = navigate().querySelector('select')!;
    expect([...cloned.selectedOptions].map((o) => o.value)).toEqual(['B', 'C']);
  });

  it('keeps the selected option of a select whose options share a value', () => {
    leave(
      '<select><option value="x">one</option><option value="x">two</option><option value="y">three</option></select>',
    );
    const live = container.querySelector('.passage select')!;
    (live as HTMLSelectElement).options[1]!.selected = true;

    expect(navigate().querySelector('select')!.selectedIndex).toBe(1);
  });

  it('keeps radio buttons, an indeterminate checkbox and other input types', () => {
    leave(
      '<input type="radio" name="r" value="1"><input type="radio" name="r" value="2"><input type="checkbox"><input type="range" min="0" max="10"><input type="color"><input type="hidden" value="secret">',
    );
    const q = (selector: string, root: ParentNode = container) =>
      root.querySelector(`${selector}`) as HTMLInputElement;
    container.querySelectorAll<HTMLInputElement>(
      '.passage input[type=radio]',
    )[1]!.checked = true;
    q('.passage input[type=checkbox]').indeterminate = true;
    q('.passage input[type=range]').value = '7';
    q('.passage input[type=color]').value = '#ff0000';

    const snapshot = navigate();
    const radios = snapshot.querySelectorAll('input[type=radio]');
    expect([...radios].map((r) => (r as HTMLInputElement).checked)).toEqual([
      false,
      true,
    ]);
    expect(q('input[type=checkbox]', snapshot).indeterminate).toBe(true);
    expect(q('input[type=range]', snapshot).value).toBe('7');
    expect(q('input[type=color]', snapshot).value).toBe('#ff0000');
    expect(q('input[type=hidden]', snapshot).value).toBe('secret');
  });

  it('keeps the scroll offsets of scrolled elements once attached', () => {
    leave('<div id="box"><textarea></textarea></div>');
    const box = container.querySelector('.passage #box') as HTMLElement;
    const textarea = container.querySelector('.passage textarea')!;
    box.scrollTop = 40;
    box.scrollLeft = 5;
    textarea.scrollTop = 12;

    const snapshot = navigate();
    const cloned = snapshot.querySelector('div')!;
    expect([cloned.scrollTop, cloned.scrollLeft]).toEqual([40, 5]);
    expect(snapshot.querySelector('textarea')!.scrollTop).toBe(12);
  });

  describe('media (#536)', () => {
    /** A video that has decoded a frame at `time`, as a browser reports it. */
    function decoded(video: HTMLVideoElement, time: number, readyState = 4) {
      Object.defineProperties(video, {
        readyState: { value: readyState },
        videoWidth: { value: 320 },
        videoHeight: { value: 180 },
      });
      video.currentTime = time;
    }
    const liveVideo = () =>
      container.querySelector('.passage video') as HTMLVideoElement;

    beforeEach(() => {
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
        function (this: HTMLCanvasElement) {
          return `data:image/jpeg;base64,${this.width}x${this.height}`;
        },
      );
    });

    it('shows the frame on screen as the poster, still and silent', () => {
      leave('<video src="clip.webm" autoplay poster="first.png"></video>');
      const live = liveVideo();
      decoded(live, 1.25);

      const cloned = navigate().querySelector('video')!;
      expect(draws.map((d) => d.source)).toEqual([live]);
      expect(draws[0]!.target.width).toBe(320);
      expect(cloned.getAttribute('poster')).toBe(
        'data:image/jpeg;base64,320x180',
      );
      expect(cloned.currentTime).toBe(1.25);
      expect(cloned.muted).toBe(true);
      expect(cloned.paused).toBe(true);
      expect(cloned.hasAttribute('autoplay')).toBe(false);
    });

    it('keeps the author poster of a video with no frame decoded yet', () => {
      leave('<video src="clip.webm" poster="first.png"></video>');
      decoded(liveVideo(), 0, 0);

      const cloned = navigate().querySelector('video')!;
      expect(cloned.getAttribute('poster')).toBe('first.png');
      expect(draws).toEqual([]);
    });

    it('survives a video that taints the canvas', () => {
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(
        () => {
          throw new DOMException('tainted', 'SecurityError');
        },
      );
      leave(
        '<video src="https://cdn.test/clip.webm" poster="first.png"></video>',
      );
      decoded(liveVideo(), 2);

      const cloned = navigate().querySelector('video')!;
      expect(cloned.getAttribute('poster')).toBe('first.png');
      expect(cloned.currentTime).toBe(2);
      expect(cloned.muted).toBe(true);
    });

    it('keeps the position of audio, silent', () => {
      leave('<audio controls src="a.ogg" autoplay></audio>');
      container.querySelector<HTMLAudioElement>('.passage audio')!.currentTime =
        3.5;

      const cloned = navigate().querySelector('audio')!;
      expect(cloned.currentTime).toBe(3.5);
      expect(cloned.muted).toBe(true);
      expect(cloned.hasAttribute('autoplay')).toBe(false);
      expect(draws).toEqual([]);
    });
  });
});
