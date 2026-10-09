// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { blockWidgetNames } from '../../src/widgets/widget-def';
import { getBackend, resetBackend } from '../../src/saves/storage';
import { saveSession } from '../../src/saves/save-manager';
import { buildExpressionFns } from '../../src/expression';
import { useStoryStore } from '../../src/store';

const passage = (content: string, tags = ['widget']) => ({
  name: 'Widgets',
  tags,
  content,
});

describe('blockWidgetNames', () => {
  it.each([
    [
      'hyphenated name',
      '{widget "wrap-box"}<div>{@children}</div>{/widget}',
      'wrap-box',
    ],
    [
      'uppercase macro name',
      '{WIDGET "Wrap"}<div>{@children}</div>{/WIDGET}',
      'Wrap',
    ],
    [
      'children with selectors',
      '{widget "Wrap"}<div>{.highlight @children}</div>{/widget}',
      'Wrap',
    ],
  ])('finds a %s', (_, content, name) => {
    expect(blockWidgetNames([passage(content)])).toEqual([name]);
  });

  it('skips widgets without a children placeholder', () => {
    expect(blockWidgetNames([passage('{widget "a"}x{/widget}')])).toEqual([]);
  });

  it.each([
    [
      'an HTML comment',
      '{widget "Badge"}<!-- This widget does not take {@children}. -->Ready{/widget}',
    ],
    [
      'a {do} body',
      '{widget "Badge"}{do}console.log("Example syntax: {@children}");{/do}Ready{/widget}',
    ],
    ['an escaped brace', '{widget "Badge"}\\{@children}Ready{/widget}'],
  ])('ignores {@children} in %s (#387)', (_, content) => {
    expect(blockWidgetNames([passage(content)])).toEqual([]);
  });

  it('reads each definition of a passage on its own (#387)', () => {
    const content =
      '{widget "A"}<!-- {/widget} -->a{/widget}\n' +
      '{widget "B"}<b>{@children}</b>{/widget}\n' +
      '{widget "C"}c{/widget}';
    expect(blockWidgetNames([passage(content)])).toEqual(['B']);
  });
});

describe('storage detection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetBackend();
  });

  it('falls back to memory when storage getters throw', async () => {
    resetBackend();
    for (const name of ['indexedDB', 'localStorage']) {
      vi.stubGlobal(name, undefined);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new DOMException('denied', 'SecurityError');
        },
      });
    }
    await expect(getBackend()).resolves.toBeDefined();
  });
});

describe('saveSession', () => {
  it('returns a storage failure instead of hiding it', () => {
    const spy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('full', 'QuotaExceededError');
      });
    const result = saveSession('ifid', {
      passage: 'Start',
      variables: {},
      history: [],
      historyIndex: 0,
    });
    spy.mockRestore();
    expect(result?.error).toBeInstanceOf(DOMException);
  });
});

describe('expression history helpers', () => {
  it('read the counters when called', () => {
    const fns = buildExpressionFns();
    expect(fns.visited('Next')).toBe(0);
    useStoryStore.setState({ visitCounts: { Next: 1 } });
    expect(fns.visited('Next')).toBe(1);
    useStoryStore.setState({ visitCounts: {} });
  });
});
