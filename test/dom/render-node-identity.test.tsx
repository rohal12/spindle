// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage, renderPassageContent } from '../../src/components/Passage';
import { defineMacro } from '../../src/define-macro';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

// Issue #175: switching to different content at the same position must
// remount child macros, so mount-only side effects ({set}, {do}) run for the
// newly shown content; re-rendering the same content must not re-run them.

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
  const passage = makePassage(99, 'Test', content);
  const container = document.createElement('div');
  act(() => {
    render(<Passage passage={passage} />, container);
  });
  return container;
}

function setVar(name: string, value: unknown) {
  act(() => {
    useStoryStore.getState().setVariable(name, value);
  });
}

const vars = () => useStoryStore.getState().variables;

describe('remounting child macros when content changes (#175)', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(
        makeStoryData([
          makePassage(1, 'Start', 'Start'),
          makePassage(2, 'B', '{set $x = 1}B'),
          makePassage(3, 'C', '{set $x = 2}C'),
          makePassage(4, 'D', '{set $x = 1}D'),
          makePassage(5, 'E', '{set $x = 1}D'),
        ]),
      );
  });

  it('runs {set} in the newly active {if} branch', () => {
    setVar('x', 0);
    setVar('y', 0);
    const el = renderPassage(
      '{if $x === 0}{set $y = 1}One{else}{set $y = 2}Two{/if}',
    );
    expect(el.textContent).toBe('One');
    expect(vars().y).toBe(1);

    setVar('x', 1);
    expect(el.textContent).toBe('Two');
    expect(vars().y).toBe(2);

    setVar('x', 0);
    expect(el.textContent).toBe('One');
    expect(vars().y).toBe(1);
  });

  it('runs {set} in the newly active branch when branches are identical', () => {
    setVar('x', 0);
    setVar('n', 0);
    const el = renderPassage(
      '{if $x === 0}{set $n += 1}Same{else}{set $n += 1}Same{/if}',
    );
    expect(vars().n).toBe(1);
    setVar('x', 1);
    expect(el.textContent).toBe('Same');
    expect(vars().n).toBe(2);
  });

  it('runs {do} in the newly active {if} branch', () => {
    setVar('x', 0);
    setVar('y', 0);
    renderPassage(
      '{if $x === 0}{do}$y = 1{/do}One{else}{do}$y = 2{/do}Two{/if}',
    );
    expect(vars().y).toBe(1);
    setVar('x', 1);
    expect(vars().y).toBe(2);
  });

  it('runs {set} nested in HTML in the newly active branch', () => {
    setVar('x', 0);
    setVar('y', 0);
    renderPassage(
      '{if $x === 0}<div>{set $y = 1}One</div>{else}<div>{set $y = 2}Two</div>{/if}',
    );
    expect(vars().y).toBe(1);
    setVar('x', 1);
    expect(vars().y).toBe(2);
  });

  it('runs {set} in the newly matching {switch} case', () => {
    setVar('x', 'a');
    setVar('y', 0);
    const el = renderPassage(
      '{switch $x}{case "a"}{set $y = 1}A{case "b"}{set $y = 2}B{default}{set $y = 3}D{/switch}',
    );
    expect(el.textContent).toBe('A');
    expect(vars().y).toBe(1);

    setVar('x', 'b');
    expect(el.textContent).toBe('B');
    expect(vars().y).toBe(2);

    setVar('x', 'zzz');
    expect(el.textContent).toBe('D');
    expect(vars().y).toBe(3);
  });

  it('runs {set} in a newly included passage', () => {
    setVar('which', 'B');
    const el = renderPassage('{include $which}');
    expect(el.textContent).toBe('B');
    expect(vars().x).toBe(1);

    setVar('which', 'C');
    expect(el.textContent).toBe('C');
    expect(vars().x).toBe(2);

    setVar('which', 'B');
    expect(el.textContent).toBe('B');
    expect(vars().x).toBe(1);
  });

  it('runs {set} when switching between included passages with identical content', () => {
    setVar('which', 'D');
    renderPassage('{include $which}');
    expect(vars().x).toBe(1);
    setVar('x', 5);
    setVar('which', 'E');
    expect(vars().x).toBe(1);
  });

  describe('unchanged content does not re-run on variable updates', () => {
    it('{set} in an unchanged {if} branch', () => {
      setVar('x', 0);
      setVar('n', 0);
      setVar('other', 0);
      const el = renderPassage(
        '{if $x === 0}{set $n += 1}One {$other}{else}Two{/if}',
      );
      expect(vars().n).toBe(1);
      setVar('other', 1);
      setVar('other', 2);
      expect(el.textContent).toBe('One 2');
      expect(vars().n).toBe(1);
    });

    it('{do} in an unchanged {if} branch', () => {
      setVar('x', 0);
      setVar('n', 0);
      setVar('other', 0);
      renderPassage('{if $x === 0}{do}$n += 1{/do}{$other}{else}Two{/if}');
      expect(vars().n).toBe(1);
      setVar('other', 1);
      setVar('other', 2);
      expect(vars().n).toBe(1);
    });

    it('{set} at the top level of a passage', () => {
      setVar('n', 0);
      setVar('other', 0);
      renderPassage('{set $n += 1}Value: {$other}');
      expect(vars().n).toBe(1);
      setVar('other', 1);
      setVar('other', 2);
      expect(vars().n).toBe(1);
    });

    it('{set} inside an included passage', () => {
      useStoryStore
        .getState()
        .init(
          makeStoryData([
            makePassage(1, 'Start', 'Start'),
            makePassage(2, 'Inc', '{set $n += 1}Inc {$other}'),
          ]),
        );
      setVar('n', 0);
      setVar('other', 0);
      const el = renderPassage('{include "Inc"} {$other}');
      expect(vars().n).toBe(1);
      setVar('other', 1);
      setVar('other', 2);
      expect(el.textContent).toBe('Inc 2 2');
      expect(vars().n).toBe(1);
    });

    it('a passage rendered via renderPassageContent on every render', () => {
      // PassageDisplay renders PassageReady this way on each of its renders.
      let mounts = 0;
      defineMacro({
        name: 'mountcounter',
        render(_props, ctx) {
          ctx.hooks.useEffect(() => {
            mounts++;
          }, []);
          return null;
        },
      });
      const passage = makePassage(7, 'Ready', 'A {mountcounter} B');
      const Host = (_: { tick: number }) => (
        <>{renderPassageContent(passage)}</>
      );
      const container = document.createElement('div');
      act(() => render(<Host tick={0} />, container));
      act(() => render(<Host tick={1} />, container));
      act(() => render(<Host tick={2} />, container));
      expect(mounts).toBe(1);
    });

    it('{set} inside a {for} body', () => {
      setVar('n', 0);
      setVar('other', 0);
      setVar('list', [1, 2]);
      renderPassage('{for @i of $list}{set $n += 1}{$other}{/for}');
      expect(vars().n).toBe(2);
      setVar('other', 1);
      setVar('other', 2);
      expect(vars().n).toBe(2);
    });
  });
});
