// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { parseMarkup } from '../../src/markup/parse';
import { registerWidgetDefinitions } from '../../src/widgets/register-widget-def';
import type { StoryData, Passage as PassageData } from '../../src/parser';

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

function setup(
  vars: Record<string, unknown>,
  others: PassageData[] = [],
): void {
  useStoryStore
    .getState()
    .init(makeStoryData([makePassage(1, 'Start', 'Start'), ...others]), vars);
  installStoryAPI();
}

function renderPassage(content: string): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  return container;
}

describe('computed render counts (#372)', () => {
  beforeEach(() => setup({ tick: 0 }, [makePassage(2, 'Snippet', 'Hello')]));

  it('recomputes rendered() when an include mounts', () => {
    const el = renderPassage(
      '{computed _n = rendered("Snippet")}<span id="count">{_n}</span>{include "Snippet"}',
    );
    expect(window.Story.rendered('Snippet')).toBe(1);
    expect(el.querySelector('#count')!.textContent).toBe('1');
  });

  it('recomputes hasRendered() when an include mounts', () => {
    const el = renderPassage(
      '{computed _seen = hasRendered("Snippet")}{if _seen}Seen{/if}{include "Snippet"}',
    );
    expect(el.textContent).toContain('Seen');
  });
});

describe('parameterless widgets (#371)', () => {
  beforeEach(() => setup({}));

  it('keeps the locals of a widget out of the caller', () => {
    registerWidgetDefinitions(
      parseMarkup('{widget "Inner"}{set @x = "inner"}{/widget}'),
      'Helpers',
    );
    const el = renderPassage(
      '{for @item of [0, 1]}{set @x = "outer"}{Inner}<b class="o">{@x}</b>{/for}',
    );
    expect([...el.querySelectorAll('.o')].map((b) => b.textContent)).toEqual([
      'outer',
      'outer',
    ]);
  });

  it('lets a widget set locals when invoked at passage level', () => {
    registerWidgetDefinitions(
      parseMarkup(
        '{widget "Inner"}{set @x = "inner"}<i class="i">{@x}</i>{/widget}',
      ),
      'Helpers',
    );
    const el = renderPassage('{Inner}');
    expect(el.querySelector('.i')!.textContent).toBe('inner');
    expect(el.querySelector('.error')).toBeNull();
  });
});

describe('inline-only containers (#374)', () => {
  beforeEach(() => setup({ n: 0 }));

  it('renders a button label without block markdown', () => {
    const el = renderPassage('<button id="b">+\n{$n}</button>');
    const html = el.querySelector('#b')!.innerHTML;
    expect(html).not.toMatch(/<(ul|li|p)[ >]/);
    expect(el.querySelector('#b')!.textContent).toContain('+');
    expect(el.querySelector('#b')!.textContent).toContain('0');
  });

  it('renders a heading without a nested paragraph', () => {
    const el = renderPassage('<h2>Heading</h2>');
    expect(el.querySelector('h2')!.innerHTML).toBe('Heading');
  });
});

describe('{for} while a control edits its item (#369)', () => {
  beforeEach(() => setup({ items: [{ name: '', flag: false }], n: 0 }));

  it('keeps the iteration mounted while typing', () => {
    const el = renderPassage(
      '{for @item of $items}{textbox $items.0.name}{/for}',
    );
    const input = el.querySelector('input')!;
    input.focus();
    for (const text of ['A', 'Ad', 'Ada']) {
      act(() => {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(el.querySelector('input')).toBe(input);
    }
    expect(document.activeElement).toBe(input);
    expect((window.Story.get('items') as { name: string }[])[0]!.name).toBe(
      'Ada',
    );
  });

  it('does not rerun mount-only macros when a checkbox toggles', () => {
    const el = renderPassage(
      '{for @item of $items}{set $n += 1}{checkbox $items.0.flag}{/for}',
    );
    expect(window.Story.get('n')).toBe(1);
    act(() => {
      el.querySelector('input')!.click();
    });
    expect(window.Story.get('n')).toBe(1);
  });

  it('still remounts when the list is replaced', () => {
    const el = renderPassage(
      '{for @item of $items}{set @copy = @item.name}{print @copy}{/for}',
    );
    act(() => {
      window.Story.set('items', [{ name: 'x' }]);
    });
    expect(el.textContent).toBe('x');
  });
});
