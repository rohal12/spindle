// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage as PassageData } from '../../src/parser';

const start: PassageData = {
  pid: 1,
  name: 'Start',
  tags: [],
  metadata: {},
  content: '',
};

const storyData: StoryData = {
  name: 'Test',
  startNode: 1,
  ifid: 'test',
  format: 'spindle',
  formatVersion: '0.1.0',
  passages: new Map([['Start', start]]),
  passagesById: new Map([[1, start]]),
  userCSS: '',
  userScript: '',
};

const vars = () => useStoryStore.getState().variables as Record<string, any>;

describe('input bindings below a shared object (#305)', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(storyData, { a: { name: 'old' }, b: { name: 'old' } }, {});
    installStoryAPI();
  });

  it.each([
    ['$fo\\u006f', { foo: 'Ada' }, 'foo'],
    ['$fo\\u{6f}', { foo: 'Ada' }, 'foo'],
    ['$\\u005ffoo', { _foo: 'Ada' }, '_foo'],
    ['$a.na\\u006de', { a: { name: 'Ada' } }, 'a'],
    ['"$fo\\u006f"', { foo: 'Ada' }, 'foo'],
    ['"$a.na\\u006de"', { a: { name: 'Ada' } }, 'a'],
  ])(
    'binds the decoded identifier in %s (#588)',
    (reference, variables, root) => {
      useStoryStore.getState().init(storyData, variables, {});
      const container = document.createElement('div');
      act(() =>
        render(
          <Passage passage={{ ...start, content: `{textbox ${reference}}` }} />,
          container,
        ),
      );
      const input = container.querySelector('input')!;
      expect(input.value).toBe('Ada');
      act(() => {
        input.value = 'Bob';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(vars()[root]).toEqual(root === 'a' ? { name: 'Bob' } : 'Bob');
      expect(Object.keys(vars())).toEqual([root]);
      act(() => render(null, container));
    },
  );

  it.each(['$\\u005f_proto__', '$a.\\u005f_proto__'])(
    'rejects the decoded reserved name in %s',
    (reference) => {
      const container = document.createElement('div');
      act(() =>
        render(
          <Passage passage={{ ...start, content: `{textbox ${reference}}` }} />,
          container,
        ),
      );
      expect(container.querySelector('input')).toBeNull();
      expect(container.querySelector('.error')?.textContent).toContain(
        '__proto__ is reserved',
      );
      act(() => render(null, container));
    },
  );

  it.each(['\\u005ffoo', '"\\u005ffoo"'])(
    'refuses an escaped temporary namespace in %s',
    (reference) => {
      const container = document.createElement('div');
      act(() =>
        render(
          <Passage passage={{ ...start, content: `{textbox ${reference}}` }} />,
          container,
        ),
      );
      expect(container.querySelector('input')).toBeNull();
      expect(container.querySelector('.error')?.textContent).toContain(
        'literal $',
      );
      expect(vars()).not.toHaveProperty('_foo');
      act(() => render(null, container));
    },
  );

  it('keeps variables sharing the bound object one object', () => {
    const container = document.createElement('div');
    const passage: PassageData = {
      ...start,
      content: '{set $b = $a}\n{textbox $a.name}\nB: {$b.name}',
    };
    act(() => {
      render(<Passage passage={passage} />, container);
    });
    const input = container.querySelector('input')!;
    act(() => {
      input.value = 'new';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(vars().a.name).toBe('new');
    expect(vars().b.name).toBe('new');
    expect(vars().a).toBe(vars().b);
  });
});
