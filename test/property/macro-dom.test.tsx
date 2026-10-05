// @vitest-environment happy-dom
/**
 * Macro-level differential properties: passages with generated macro
 * arguments are rendered through the real tokenizer, parser and macros, and
 * what the macro receives or shows must match the generated values.
 *
 * Rendering a passage per case is slower than calling a parser, so these
 * properties run a third of the configured budget (at least 30 cases).
 */
import { describe, expect, beforeAll, beforeEach } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { NUM_RUNS, fcOptions } from './config';
import { EXPR_ENV, exprArbs, quotedLabel, type Expr } from './js-arbitraries';
import { structEqual } from './struct-equal';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { defineMacro } from '../../src/define-macro';
import { registerWidget } from '../../src/widgets/widget-registry';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { readWholeQuoted } from '../../src/components/macros/arg-utils';
import type { StoryData, Passage as PassageData } from '../../src/parser';

const domOptions = {
  ...fcOptions,
  numRuns: Math.max(30, Math.round(NUM_RUNS / 3)),
};

// Passage markup: no regex literals or comments (the passage tokenizer
// does not lex JavaScript), no line breaks inside literals (a quoted string
// ends at a line break there), `$` variables only (no locals at passage
// level), and no `{` in labels (`{$x}` would interpolate).
const dom = exprArbs({
  sigils: ['$'],
  regex: false,
  comments: false,
  newlines: false,
});
const domLabel = quotedLabel({ newlines: false, braces: false });

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function initStory(extraPassages: string[] = []): void {
  const passages = [
    makePassage(1, 'Start', 'Start'),
    ...extraPassages.map((name, i) => makePassage(10 + i, name, 'Target')),
  ];
  const storyData: StoryData = {
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
  useStoryStore.getState().init(storyData, { ...EXPR_ENV.variables });
}

let container: HTMLElement | null = null;

function renderPassage(content: string): HTMLElement {
  if (container) act(() => render(null, container!));
  container = document.createElement('div');
  const el = container;
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, el);
  });
  return el;
}

/** Locals seen by the most recent `{propcapture}`. */
let captured: Record<string, unknown> | null = null;

beforeAll(() => {
  defineMacro({
    name: 'propcapture',
    render(_props, ctx) {
      captured = { ...ctx.getValues() };
      return null;
    },
  });
});

beforeEach(() => {
  initStory();
  installStoryAPI();
});

function withSeps(exprs: Expr[], seps: string[]): string {
  return exprs.map((e, i) => (i === 0 ? '' : seps[i - 1]!) + e.src).join('');
}

const PARAMS = ['@p0', '@p1', '@p2', '@p3'];

function widgetCall(arb: fc.Arbitrary<Expr>, sep: fc.Arbitrary<string>) {
  return fc
    .array(arb, { minLength: 2, maxLength: PARAMS.length })
    .chain((exprs) =>
      fc
        .array(sep, {
          minLength: exprs.length - 1,
          maxLength: exprs.length - 1,
        })
        .map((seps) => ({ exprs, raw: withSeps(exprs, seps) })),
    );
}

describe('widget invocation', () => {
  beforeAll(() => {
    registerWidget('PropW', buildAST(tokenize('{propcapture}')), PARAMS);
  });

  function expectParams(exprs: Expr[]) {
    expect(captured).not.toBeNull();
    PARAMS.forEach((p, i) => {
      const expected = i < exprs.length ? exprs[i]!.value : undefined;
      expect(captured![p.slice(1)]).toEqual(expected);
    });
  }

  test.prop(
    [widgetCall(dom.any, fc.constantFrom(',', ', ', ' , '))],
    domOptions,
  )('comma-separated arguments reach the parameters', ({ exprs, raw }) => {
    captured = null;
    renderPassage(`{PropW ${raw}}`);
    expectParams(exprs);
  });

  test.prop(
    [widgetCall(dom.standalone, fc.constantFrom(' ', '  ', '\t'))],
    domOptions,
  )('space-separated arguments reach the parameters', ({ exprs, raw }) => {
    captured = null;
    renderPassage(`{PropW ${raw}}`);
    expectParams(exprs);
  });
});

describe('{meter}', () => {
  const meter = fc
    .tuple(dom.standalone, dom.any, fc.option(domLabel, { nil: undefined }))
    .filter(
      ([, max, label]) =>
        label !== undefined || readWholeQuoted(max.src) === null,
    );

  test.prop([meter], domOptions)(
    'shows the evaluated values with the label',
    ([cur, max, label]) => {
      const el = renderPassage(
        `{meter ${cur.src} ${max.src}${label ? ` ${label.quoted}` : ''}}`,
      );
      expect(el.querySelector('.error')).toBeNull();
      const c = Number(cur.value);
      const m = Number(max.value);
      const mode = label?.text ?? '';
      const text =
        mode === 'none'
          ? null
          : mode === '%'
            ? `${m === 0 ? 0 : Math.round((c / m) * 100)}%`
            : mode
              ? `${c} ${mode} / ${m} ${mode}`
              : `${c} / ${m}`;
      const shown = el.querySelector('.macro-meter-label');
      expect(shown?.textContent ?? null).toBe(text);
    },
  );
});

describe('quoted labels in macros (#200)', () => {
  test.prop([domLabel], domOptions)('button', ({ text, quoted }) => {
    const el = renderPassage(`{button ${quoted}}{/button}`);
    expect(el.querySelector('button')!.textContent).toBe(text);
  });

  test.prop([domLabel], domOptions)('dialog', ({ text, quoted }) => {
    const el = renderPassage(`{dialog ${quoted}}Help{/dialog}`);
    expect(el.querySelector('button')!.textContent).toBe(text);
  });

  test.prop([domLabel], domOptions)('checkbox', ({ text, quoted }) => {
    const el = renderPassage(`{checkbox $agree ${quoted}}`);
    expect(el.querySelector('label')!.textContent).toBe(text ? ` ${text}` : '');
  });

  test.prop([domLabel, domLabel], domOptions)(
    'radiobutton value and label',
    (value, label) => {
      act(() => window.Story.set('color', value.text));
      const el = renderPassage(
        `{radiobutton $color ${value.quoted} ${label.quoted}}`,
      );
      expect(el.querySelector('label')!.textContent).toBe(
        label.text ? ` ${label.text}` : '',
      );
      expect((el.querySelector('input') as HTMLInputElement).checked).toBe(
        true,
      );
    },
  );

  test.prop([domLabel], domOptions)(
    'textbox placeholder',
    ({ text, quoted }) => {
      const el = renderPassage(`{textbox $name ${quoted}}`);
      expect(el.querySelector('input')!.getAttribute('placeholder') ?? '').toBe(
        text,
      );
    },
  );

  test.prop(
    [
      fc.uniqueArray(domLabel, {
        selector: (l) => l.text,
        minLength: 1,
        maxLength: 3,
      }),
    ],
    domOptions,
  )('listbox options', (labels) => {
    const el = renderPassage(
      `{listbox $pick}${labels.map((l) => `{option ${l.quoted}}`).join('')}{/listbox}`,
    );
    const options = [...el.querySelectorAll('option')];
    expect(options.map((o) => o.value)).toEqual(labels.map((l) => l.text));
  });

  test.prop(
    [domLabel, domLabel.filter((p) => p.text.trim() !== '')],
    domOptions,
  )('link text and passage', (display, passage) => {
    initStory([passage.text]);
    const el = renderPassage(
      `{link ${display.quoted} ${passage.quoted}}{/link}`,
    );
    const a = el.querySelector('a')!;
    expect(a.textContent).toBe(display.text);
    act(() => a.click());
    expect(useStoryStore.getState().currentPassage).toBe(passage.text);
  });
});

describe('{for} remounting', () => {
  /** Items that are often structurally equal to each other. */
  const item = fc.letrec((tie) => ({
    item: fc.oneof(
      { depthSize: 'small' },
      fc.constantFrom<unknown>(
        0,
        -0,
        1,
        NaN,
        '1',
        'a',
        '',
        null,
        undefined,
        true,
        1n,
        new Date(0),
      ),
      tie('array'),
      tie('object'),
      tie('map'),
      tie('set'),
    ),
    array: fc.array(tie('item'), { maxLength: 2 }),
    object: fc.dictionary(fc.constantFrom('x', 'y'), tie('item'), {
      maxKeys: 2,
    }),
    map: fc
      .array(fc.tuple(fc.constantFrom('k', 'm'), tie('item')), { maxLength: 2 })
      .map((entries) => new Map(entries)),
    set: fc
      .array(tie('item'), { maxLength: 2 })
      .map((members) => new Set(members)),
  })).item;

  const lists = fc.array(fc.array(item, { maxLength: 4 }), {
    minLength: 2,
    maxLength: 5,
  });

  test.prop([lists], domOptions)(
    'an iteration remounts exactly when its item content changes',
    ([first, ...rest]) => {
      // Mount id and local copy per iteration index.
      const seen = new Map<number, { mount: number; copy: unknown }>();
      let mounts = 0;
      defineMacro({
        name: 'propmount',
        render(_props, ctx) {
          const id = ctx.hooks.useRef(0);
          if (id.current === 0) id.current = ++mounts;
          const locals = ctx.getValues();
          seen.set(locals.i as number, {
            mount: id.current,
            copy: locals.copy,
          });
          return null;
        },
      });

      act(() => window.Story.set('items', first));
      renderPassage(
        '{for @item, @i of $items}{set @copy = @item}{propmount}{/for}',
      );
      let prev = useStoryStore.getState().variables.items as unknown[];
      let prevMounts = new Map(seen);

      for (const list of rest) {
        seen.clear();
        act(() => window.Story.set('items', list));
        const items = useStoryStore.getState().variables.items as unknown[];
        items.forEach((current, i) => {
          const now = seen.get(i);
          expect(now).toBeDefined();
          const same = i < prev.length && structEqual(prev[i], current);
          if (same) expect(now!.mount).toBe(prevMounts.get(i)!.mount);
          else expect(now!.mount).not.toBe(prevMounts.get(i)?.mount);
          // The local copy taken at mount matches the current item.
          expect(structEqual(now!.copy, current)).toBe(true);
        });
        prev = items;
        prevMounts = new Map(
          items.map((_, i) => [i, seen.get(i) ?? prevMounts.get(i)!]),
        );
      }
    },
  );
});
