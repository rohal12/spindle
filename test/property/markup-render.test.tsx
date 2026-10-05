// @vitest-environment happy-dom
import { describe, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import { markdownToHtml } from '../../src/markup/markdown';
import type { StoryData, Passage as PassageData } from '../../src/parser';
import { NUM_RUNS, fcOptions } from './config';
import { INLINE_TAGS, richPassage, substituteVars } from './markup-rich';
import {
  TEXT_WIDGETS,
  codePieces,
  outerLocal,
  pieces,
  textVars,
  type TextEnv,
  type TextPiece,
  type TextVars,
} from './markup-text';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import {
  registerWidget,
  clearWidgets,
} from '../../src/widgets/widget-registry';

/**
 * DOM properties mount a full Passage per case, so CI runs fewer cases than
 * the pure parser properties. FC_NUM_RUNS overrides this for deep runs.
 */
const DOM_RUNS = process.env.FC_NUM_RUNS ? NUM_RUNS : Math.min(NUM_RUNS, 100);
const domOptions = { ...fcOptions, numRuns: DOM_RUNS };
const domTimeout = Math.max(5000, DOM_RUNS * 50);

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function initStory(
  variables: Record<string, unknown> = {},
  extraPassages: string[] = [],
) {
  const passages = [makePassage(1, 'Start', 'Start')];
  extraPassages.forEach((name, i) =>
    passages.push(makePassage(i + 2, name, name)),
  );
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
  useStoryStore.getState().init(storyData, variables);
}

/** Render passage content, run `check` on its element, then unmount. */
function withPassage(content: string, check: (el: HTMLElement) => void) {
  const container = document.createElement('div');
  act(() => {
    render(<Passage passage={makePassage(99, 'Test', content)} />, container);
  });
  try {
    check(container.querySelector('.passage') as HTMLElement);
  } finally {
    act(() => render(null, container));
  }
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Everything a reader is shown: text, plus attribute values, where variables
 * in image alt text and link titles end up.
 */
function shownText(el: HTMLElement): string {
  const attrs = Array.from(el.querySelectorAll('*')).flatMap((node) =>
    Array.from(node.attributes).map((a) => a.value),
  );
  return [el.textContent ?? '', ...attrs].join('\n');
}

/** No placeholder markup or escape guard may reach the DOM, anywhere. */
function expectNoLeak(el: HTMLElement) {
  expect(el.querySelector('.error')).toBeNull();
  const text = el.textContent ?? '';
  expect(text).not.toContain('data-tw');
  expect(text).not.toMatch(/[\uE000-\uF8FF]/);
  expect(el.querySelector('[data-tw]')).toBeNull();
  for (const node of Array.from(el.querySelectorAll('*'))) {
    for (const attr of Array.from(node.attributes)) {
      expect(attr.value).not.toContain('data-tw');
      expect(attr.value).not.toMatch(/[\uE000-\uF8FF]/);
    }
  }
}

beforeEach(() => {
  initStory();
  installStoryAPI();
});

describe('markdown parity', () => {
  // Text without spindle markup ({, [[, <) must render exactly as micromark
  // renders it with spindle's extensions, whichever internal path is taken.
  const markupFreeText = fc
    .array(
      fc.oneof(
        { weight: 4, arbitrary: fc.stringMatching(/^[a-z]{1,5}$/) },
        { weight: 3, arbitrary: fc.constantFrom(' ', '  ', '\n', '\n\n') },
        {
          weight: 3,
          arbitrary: fc.constantFrom(
            ...['*', '**', '_', '`', '``', '~~', '#', '# ', '> ', '- ', '+ '],
            ...['1. ', '2) ', '|', ' | ', '---', '\n| --- | --- |\n', '\\'],
            ...['\\\\', '\\*', '&amp;', '&#123;', '&copy;', '&bogus;', '!'],
            ...['[a](b)', '![x](y.png)', '[', ']', '(', ')', '  \n', '\t'],
            ...['}', '=', '===', '"', "'", '    ', '```', '~~~', 'é'],
          ),
        },
      ),
      { maxLength: 25 },
    )
    .map((parts) => parts.join(''))
    .filter((s) => !s.includes('[['));

  test.prop([markupFreeText], domOptions)(
    'markup-free text renders the same HTML as micromark',
    (text) => {
      const expected = document.createElement('div');
      expected.innerHTML = markdownToHtml(text);
      withPassage(text, (el) => {
        expect(el.innerHTML.trim()).toBe(expected.innerHTML.trim());
      });
    },
    domTimeout,
  );

  /**
   * Without <p> wrappers (nobr passages, inline elements) content renders as
   * micromark's output with the top-level paragraphs unwrapped, and keeps the
   * whitespace at its edges, which separates it from its neighbours.
   */
  function unwrappedMarkdown(text: string, inline: boolean): string {
    const lead = /^[ \t\n]*/.exec(text)![0];
    const trail = lead === text ? '' : /[ \t\n]*$/.exec(text)![0];
    const ref = document.createElement('div');
    ref.innerHTML = markdownToHtml(text, { inline }).trim();
    for (const p of Array.from(ref.querySelectorAll(':scope > p'))) {
      p.replaceWith(...Array.from(p.childNodes));
    }
    return lead + ref.innerHTML + trail;
  }

  test.prop([markupFreeText], domOptions)(
    'markup-free text in a nobr passage renders unwrapped micromark HTML',
    (text) => {
      const container = document.createElement('div');
      const passage = { ...makePassage(99, 'Test', text), tags: ['nobr'] };
      act(() => render(<Passage passage={passage} />, container));
      try {
        const el = container.querySelector('.passage')!;
        expect(el.innerHTML).toBe(unwrappedMarkdown(text, false));
      } finally {
        act(() => render(null, container));
      }
    },
    domTimeout,
  );

  test.prop([fc.constantFrom(...INLINE_TAGS), markupFreeText], domOptions)(
    'markup-free text in an inline element renders unwrapped micromark HTML',
    (tag, text) => {
      withPassage(`<${tag} id="in">${text}</${tag}>`, (el) => {
        expect(el.querySelector('#in')!.innerHTML).toBe(
          unwrappedMarkdown(text, true),
        );
      });
    },
    domTimeout,
  );
});

/** Variable names, the first ones those of Object.prototype members. */
const INHERITED = ['constructor', 'toString', 'valueOf', 'hasOwnProperty'];
const varName = (k: number) => INHERITED[k] ?? `v${k}`;

describe('placeholders', () => {
  test.prop([richPassage()], domOptions)(
    'never leak, and every variable renders its value exactly once',
    (raw) => {
      const { src, count } = substituteVars(raw, (k) => `{$${varName(k)}}`);
      const vars: Record<string, string> = {};
      for (let k = 0; k < count; k++) vars[varName(k)] = `«${k}»`;
      initStory(vars);
      withPassage(src, (el) => {
        expectNoLeak(el);
        const text = shownText(el);
        for (let k = 0; k < count; k++) {
          expect(countOf(text, `«${k}»`), `{$v${k}} in ${src}`).toBe(1);
        }
      });
    },
    domTimeout,
  );

  test.prop([richPassage()], domOptions)(
    'unset variables render as nothing, whatever their name',
    (raw) => {
      const sigils = ['$', '_', '%', '@'];
      const { src } = substituteVars(
        raw,
        (k) => `{${sigils[k % 4]}${INHERITED[k % INHERITED.length]}}`,
      );
      initStory();
      withPassage(src, (el) => {
        expectNoLeak(el);
        expect(shownText(el)).not.toMatch(/native code|function/);
      });
    },
    domTimeout,
  );

  test.prop([richPassage(), fc.constantFrom('x', ...INHERITED)], domOptions)(
    'variables in every context update after Story.set',
    (raw, name) => {
      const { src, count } = substituteVars(raw, () => `{$${name}}`);
      initStory({ [name]: '«old»' });
      withPassage(src, (el) => {
        expect(countOf(shownText(el), '«old»')).toBe(count);
        act(() => window.Story.set(name, '«new»'));
        expectNoLeak(el);
        expect(countOf(shownText(el), '«old»')).toBe(0);
        expect(countOf(shownText(el), '«new»')).toBe(count);
      });
    },
    domTimeout,
  );
});

describe('inline elements', () => {
  const BLOCK_SELECTOR =
    'p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, table, hr';

  // Generated inline elements carry data-inline, author-written block
  // elements data-author. A block element markdown produced must not sit
  // inside an inline element unless an author block element is in between.
  test.prop(
    [
      fc.constantFrom(...INLINE_TAGS),
      richPassage({ inlineAttr: 'data-inline', blockAttr: 'data-author' }),
    ],
    domOptions,
  )(
    'never contain markdown block elements',
    (tag, raw) => {
      const { src, count } = substituteVars(raw, (k) => `{$v${k}}`);
      const vars: Record<string, string> = {};
      for (let k = 0; k < count; k++) vars[`v${k}`] = `«${k}»`;
      initStory(vars);
      withPassage(`<${tag} data-inline>${src}</${tag}>`, (el) => {
        expectNoLeak(el);
        const shown = shownText(el);
        for (let k = 0; k < count; k++) {
          expect(countOf(shown, `«${k}»`), `{$v${k}} in ${src}`).toBe(1);
        }
        for (const block of Array.from(el.querySelectorAll(BLOCK_SELECTOR))) {
          if (block.hasAttribute('data-author')) continue;
          const context = block.parentElement?.closest(
            '[data-inline], [data-author]',
          );
          expect(
            context?.hasAttribute('data-inline') ?? false,
            `<${block.localName}> inside <${context?.localName}> for ${src}`,
          ).toBe(false);
        }
      });
    },
    domTimeout,
  );
});

describe('HTML attributes', () => {
  /** Attributes the HTML spec treats as booleans: compared by presence. */
  const BOOLEAN = new Set(['hidden', 'disabled', 'checked', 'open', 'inert']);

  const attrName = fc.oneof(
    fc.stringMatching(/^[a-z][a-z0-9-]{0,6}$/),
    fc.stringMatching(/^data-[a-z0-9-]{1,6}$/),
    fc.stringMatching(/^aria-[a-z]{1,6}$/),
    fc.constantFrom(
      ...['id', 'title', 'class', 'lang', 'dir', 'role', 'href', 'target'],
      ...['rel', 'tabindex', 'draggable', 'spellcheck', 'translate'],
      ...['contenteditable', 'hidden', 'Title', 'DATA-X', 'xml:lang'],
      ...['onclick', 'style', 'width', 'name', 'value', 'type', 'alt'],
      ...['onFocus', 'key', 'ref', 'children', 'className', '__proto__'],
    ),
  );
  const attrValue = fc.string({
    unit: fc.constantFrom(
      ...'aZ0 -_.:/;#!?()*é\t\n',
      '&amp;',
      '&lt;',
      '&quot;',
      '&#39;',
      '&#x41;',
      '&copy;',
      '&nbsp;',
      '&',
      '>',
      '<',
      '=',
    ),
    maxLength: 8,
  });
  const attribute = fc
    .tuple(
      attrName,
      fc.constantFrom('bare', '"', "'", 'unquoted'),
      attrValue,
      fc.constantFrom('', ' ', '\n'),
      fc.constantFrom('', ' ', '\t'),
    )
    .map(([name, quote, raw, s1, s2]) => {
      if (quote === 'bare') return ` ${name}`;
      if (quote === 'unquoted') {
        // A trailing `/` belongs to an unquoted value (`a=/>` is "/"), but
        // happy-dom's reference parser reads it as a self-closing slash.
        const value = raw.replace(/[\s"'=<>`]/g, '').replace(/\/+$/, '') || 'v';
        return ` ${name}${s1}=${s2}${value}`;
      }
      return ` ${name}${s1}=${s2}${quote}${raw.split(quote).join('')}${quote}`;
    });

  function attributesOf(el: Element): Record<string, string> {
    const out: Record<string, string> = {};
    for (const a of Array.from(el.attributes)) {
      out[a.name] = BOOLEAN.has(a.name) ? '(present)' : a.value;
    }
    return out;
  }

  test.prop(
    [
      fc.constantFrom('span', 'div', 'a', 'b', 'p', 'section', 'em'),
      fc.array(attribute, { maxLength: 4 }),
    ],
    domOptions,
  )(
    'render with the attributes a browser parses from the same HTML',
    (tag, attrs) => {
      const html = `<${tag}${attrs.join('')}>x</${tag}>`;
      // happy-dom's reference parser ends the tag at `-->` or `--!>` (`a-->`,
      // `a=--!>`) as if closing a comment; browsers read `a--` and `>`.
      fc.pre(!/--!?>/.test(html));
      // The browser's HTML parser, via a template (happy-dom's DOMParser
      // leaks a document per call, which deep runs run out of memory on).
      const reference = document.createElement('template');
      reference.innerHTML = html;
      const expected = attributesOf(reference.content.firstElementChild!);
      withPassage(html, (el) => {
        expect(el.querySelector('.error')).toBeNull();
        const rendered = el.querySelector(tag);
        expect(rendered, html).not.toBeNull();
        expect(attributesOf(rendered!), html).toEqual(expected);
      });
    },
    domTimeout,
  );
});

describe('markup in attribute values (#225)', () => {
  beforeAll(() => {
    for (const widget of TEXT_WIDGETS) {
      registerWidget(
        widget.name,
        buildAST(tokenize(widget.body)),
        widget.params,
      );
    }
  });
  afterAll(() => clearWidgets());

  /** Render the value in an element, in an outer loop when `outer` is set. */
  function attributeCase(
    value: TextPiece,
    vars: TextVars,
    next: TextVars,
    outer: string | undefined,
    [codeName, code]: [string, TextPiece],
  ) {
    const element = `<span id="t" title="${value.src}" ${codeName}="${code.src}">x</span>`;
    const src =
      outer === undefined
        ? element
        : `{for @o of [${JSON.stringify(outer)}]}${element}{/for}`;
    const locals = outer === undefined ? {} : { o: outer };
    initStory({ ...vars });
    withPassage(src, (el) => {
      const check = (env: TextEnv) => {
        const out = value.ref(env, true);
        const codeOut = code.ref(env, true);
        const span = el.querySelector('#t')!;
        expect(span.getAttribute('title'), src).toBe(out.text);
        expect(span.getAttribute(codeName), src).toBe(codeOut.text);
        expect(el.querySelectorAll('.error').length, src).toBe(
          out.errors + codeOut.errors,
        );
        // Nothing that can't resolve ran: no {set}, no {goto}.
        expect(useStoryStore.getState().variables.n, src).toBe(env.vars.n);
        expect(useStoryStore.getState().currentPassage, src).toBe('Start');
      };
      check({ vars, locals });
      act(() => {
        for (const [k, v] of Object.entries(next)) window.Story.set(k, v);
      });
      check({ vars: next, locals });
    });
  }

  // Text, escapes, character references, variables, expressions and text
  // macros resolve to the string the reference evaluator gives, inside a
  // loop (whose @o the value may read) or not, and follow Story.set.
  // Next to it sits a code attribute (an event handler, pattern or srcdoc),
  // where only sigil references resolve and other braces are code.
  const codeAttribute = fc.tuple(
    fc.constantFrom('onclick', 'onmouseover', 'onfocus', 'pattern', 'srcdoc'),
    codePieces,
  );

  test.prop(
    [pieces(2), textVars, textVars, outerLocal, codeAttribute],
    domOptions,
  )(
    'resolve to the reference text and follow their variables',
    attributeCase,
    domTimeout,
  );

  // Markup that can't resolve (macros without a text form, unknown macros,
  // failing expressions) shows one error per evaluation, adds no text and
  // never runs, while the rest of the value still resolves.
  test.prop(
    [
      pieces(2, { failing: true }),
      textVars,
      textVars,
      outerLocal,
      codeAttribute,
    ],
    domOptions,
  )(
    'report what cannot resolve, and run none of it',
    attributeCase,
    domTimeout,
  );
});

describe('escaped braces (docs/markup.md "Escaped Braces")', () => {
  // A backslash run before a brace: an odd run escapes the brace, an even
  // one doesn't; either way the backslashes pair up like markdown's `\\`.
  const context = fc.constantFrom(
    (s: string) => s,
    (s: string) => `*${s}*`,
    (s: string) => `<b>${s}</b>`,
    (s: string) => `<span>${s}</span>`,
    (s: string) => `- ${s}`,
    (s: string) => `> ${s}`,
    (s: string) => `## ${s}`,
    (s: string) => `| h |\n| --- |\n| ${s} |`,
    (s: string) => `{if true}${s}{/if}`,
  );
  const target = fc.constantFrom(
    { markup: '{$x}', shown: 'V' },
    { markup: '{_t}', shown: 'T' },
    { markup: '{%tr}', shown: 'R' },
    { markup: '{print "P"}', shown: 'P' },
    { markup: '{.c $x}', shown: 'V' },
  );

  test.prop([fc.nat({ max: 9 }), target, context], domOptions)(
    'show floor(n/2) backslashes, then the literal markup (odd n) or its value',
    (n, { markup, shown }, wrap) => {
      initStory({ x: 'V' });
      act(() => {
        useStoryStore.getState().setTemporary('t', 'T');
        useStoryStore.getState().setTransient('tr', 'R');
      });
      withPassage(wrap(`a${'\\'.repeat(n)}${markup}b`), (el) => {
        expectNoLeak(el);
        const visible = n % 2 === 1 ? markup : shown;
        expect(el.textContent).toContain(
          `a${'\\'.repeat(Math.floor(n / 2))}${visible}b`,
        );
      });
    },
    domTimeout,
  );
});

describe('Twine links', () => {
  /**
   * Passage names without separators, brackets or a selector prefix. Link
   * text is literal, so `{$x}` and `&amp;` show as written.
   */
  const name = fc
    .string({
      unit: fc.constantFrom(...'abZ09 _-"\'\\$.#!?&*`é{}', '{$x}', '&amp;'),
      minLength: 1,
      maxLength: 10,
    })
    .map((s) => s.trim())
    .filter((s) => s !== '' && !/^[.#]/.test(s));

  test.prop(
    [fc.constantFrom('plain', 'pipe', 'arrow', 'reverse'), name, name],
    domOptions,
  )(
    'show the display text and navigate to the target',
    (form, display, target) => {
      const src =
        form === 'plain'
          ? `[[${target}]]`
          : form === 'pipe'
            ? `[[${display}|${target}]]`
            : form === 'arrow'
              ? `[[${display}->${target}]]`
              : `[[${target}<-${display}]]`;
      const shown = form === 'plain' ? target : display;
      initStory({}, target === 'Start' ? [] : [target]);
      withPassage(src, (el) => {
        const links = el.querySelectorAll('a.macro-link');
        expect(links.length, src).toBe(1);
        expect(links[0]!.textContent).toBe(shown);
        act(() => (links[0] as HTMLElement).click());
        expect(useStoryStore.getState().currentPassage).toBe(target);
      });
    },
    domTimeout,
  );
});
