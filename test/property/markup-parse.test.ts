import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  lineColumn,
  MarkupError,
  parseMarkup,
  tokenizeMarkup,
} from '../../src/markup/parse';
import type { Token } from '../../src/markup/tokens';
import { interpolateCode, interpolateText } from '../../src/interpolation';
import {
  registerWidget,
  clearWidgets,
} from '../../src/widgets/widget-registry';
import { fcOptions } from './config';
import {
  TEXT_WIDGETS,
  codePieces,
  outerLocal,
  pieces,
  textVars,
} from './markup-text';
import {
  DO_CODE,
  linkArb,
  markupNoise,
  mutatedPassage,
  normalizeAST,
  passageArb,
  propTimeout,
} from './markup-arbitraries';
import { expectAboutLinear, LINEAR_TIMEOUT } from '../support/linear-time';

/** One or more redundant void-element closers, which the parser drops. */
const VOID_CLOSER =
  /^(?:<\/(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\s*>)+$/i;

/**
 * Errors about nesting, which point at the start of the offending macro or
 * element tag: what the flat tokens hold as a macro or HTML token.
 */
const NESTING_ERROR =
  /^(Unclosed (\{\S+\}|<\S+>): no |\S+ found where |\S+ closes nothing: |\{\S+\} must be directly inside )/;

/**
 * Tokens tile the input in order: each starts where the previous ended,
 * except for dropped redundant void-element closers (`</br>`). Text tokens
 * hold their exact source slice, apart from escaped braces (`\{` → `{`).
 */
function expectTokensTileInput(input: string, tokens: Token[]) {
  let pos = 0;
  for (const t of tokens) {
    expect(t.start).toBeGreaterThanOrEqual(pos);
    if (t.start > pos) expect(input.slice(pos, t.start)).toMatch(VOID_CLOSER);
    expect(t.end).toBeGreaterThan(t.start);
    expect(t.end).toBeLessThanOrEqual(input.length);
    if (t.type === 'text') {
      const slice = input.slice(t.start, t.end);
      if (slice !== t.value) {
        expect(slice).toMatch(/^\\[{}]$/);
        expect(t.value).toBe(slice[1]);
      }
    }
    pos = t.end;
  }
  if (pos < input.length) expect(input.slice(pos)).toMatch(VOID_CLOSER);
}

/**
 * In text mode (attribute values) tokens tile the input too, with no links
 * or HTML; a backslash run before a brace shows one backslash per pair, and
 * an odd run's brace as text.
 */
function expectTextTokensTileInput(input: string, tokens: Token[]) {
  let pos = 0;
  for (const t of tokens) {
    expect(t.start).toBe(pos);
    expect(t.end).toBeGreaterThan(t.start);
    expect(['text', 'variable', 'expression', 'macro']).toContain(t.type);
    if (t.type === 'text') {
      const slice = input.slice(t.start, t.end);
      if (slice !== t.value) {
        const m = /^(\\+)([{}]?)$/.exec(slice);
        expect(m, slice).not.toBeNull();
        const run = m![1]!.length;
        expect(m![2] !== '').toBe(run % 2 === 1);
        expect(t.value).toBe('\\'.repeat(run >> 1) + m![2]);
        // An even run is followed by the brace it leaves live.
        if (run % 2 === 0) expect('{}').toContain(input[t.end]);
      }
    }
    pos = t.end;
  }
  expect(pos).toBe(input.length);
}

/**
 * The only errors the parser throws are MarkupErrors whose line and column
 * are those of their offset, which points at what starts the malformed
 * markup: a `{`, `<` or `[[`, an attribute value's quote, or the character a
 * tag can't hold, which the message quotes.
 */
function expectPositioned(input: string, err: unknown): MarkupError {
  expect(err).toBeInstanceOf(MarkupError);
  const e = err as MarkupError;
  expect(e.offset).toBeGreaterThanOrEqual(0);
  expect(e.offset).toBeLessThan(input.length);
  expect({ line: e.line, column: e.column }).toEqual(
    lineColumn(input, e.offset),
  );
  expect(e.message).toBe(`${e.reason} (line ${e.line}, column ${e.column})`);
  const c = input[e.offset]!;
  if (e.reason.startsWith('Unexpected ')) {
    expect(e.reason).toContain(`Unexpected ${JSON.stringify(c)} in the tag <`);
  } else if (e.reason.startsWith('Unclosed attribute value')) {
    expect(`"'`).toContain(c);
  } else {
    expect('{<[').toContain(c);
  }
  return e;
}

/** Text mode: tokens tile the input, or a positioned error. */
function expectTextTokensOrPosition(input: string) {
  let tokens: Token[];
  try {
    tokens = tokenizeMarkup(input, { text: true });
  } catch (err) {
    expectPositioned(input, err);
    return;
  }
  expectTextTokensTileInput(input, tokens);
}

/**
 * Passage markup: tokens tile the input or a positioned error, and so does
 * the AST; a nesting error points at a macro or HTML token's start.
 */
function expectParsesOrReportsPosition(input: string) {
  expectTextTokensOrPosition(input);
  let tokens: Token[];
  try {
    tokens = tokenizeMarkup(input);
  } catch (err) {
    const e = expectPositioned(input, err);
    // The AST hits the same malformed tag, or a nesting error before it
    expect(() => parseMarkup(input)).toThrow(MarkupError);
    expect(e.reason).not.toMatch(NESTING_ERROR);
    return;
  }
  expectTokensTileInput(input, tokens);
  try {
    parseMarkup(input);
  } catch (err) {
    const e = expectPositioned(input, err);
    expect(e.reason).toMatch(NESTING_ERROR);
    expect(tokens.some((t) => t.start === e.offset && t.type !== 'text')).toBe(
      true,
    );
  }
}

describe('parser robustness', () => {
  test.prop([markupNoise], fcOptions)(
    'arbitrary input tokenizes into in-order tokens or a positioned error',
    (input) => {
      expectParsesOrReportsPosition(input);
    },
    propTimeout(5),
  );

  // A few unclosed openers in a row: unfinished constructs nested inside
  // each other (`${, strings, links, tags).
  const repeatedOpeners = fc
    .tuple(
      fc.array(
        fc.constantFrom(
          ...[
            '{a',
            '{$a',
            '`',
            '${',
            '"',
            "'",
            '[[',
            '<a ',
            'x="',
            'x=',
            '{.a',
          ],
          ...['\\', '{do}', ' ', '}', '{/a}'],
        ),
        { minLength: 1, maxLength: 4 },
      ),
      fc.integer({ min: 1, max: 4 }),
    )
    .map(([frags, n]) => frags.join('').repeat(n));

  test.prop([repeatedOpeners], fcOptions)(
    'unclosed openers fail with positioned errors',
    (input) => {
      expectParsesOrReportsPosition(input);
    },
    propTimeout(5),
  );

  test.prop([mutatedPassage], fcOptions)(
    'mutated passages only fail with positioned errors',
    (input) => {
      expectParsesOrReportsPosition(input);
    },
    propTimeout(5),
  );
});

describe('parse time', { timeout: LINEAR_TIMEOUT }, () => {
  // Realistic passages, repeated: parse time grows with their length.
  // (Input built only to break parsing, such as hundreds of unclosed
  // openers, may be slow: docs/markup.md says to avoid or escape it.)
  const PASSAGES = [
    'You wake. {set $hp = $hp - 1}{if $hp > 0}Alive {print "x"}{/if} [[North]]\n',
    '<div class="stat {$stance}" data-hp="{$hp}">HP: {$hp}</div>\n',
    '{for @item of $inventory}\n- {@item}{if @item === "torch"} (lit){/if}\n{/for}\n',
    '{do}\nconst bonus = $level * 2;\nif ($str > 20) { $str = 20; }\n{/do}\n',
    '| Stat | Value |\n|------|-------|\n| STR | {$str} |\n\n**Careful.** _Something_ moves.\n',
    '{switch $d}{case "easy"}Gentle.{case "hard"}No mercy.{default}Fair.{/switch}\n',
  ];

  it.each(PASSAGES)('stays about linear on %j repeated', (passage) => {
    const small = passage.repeat(50);
    const large = passage.repeat(400);
    expectAboutLinear(
      () => parseMarkup(small),
      () => parseMarkup(large),
    );
  });
});

describe('grammar round trip', () => {
  test.prop([passageArb], fcOptions)(
    'well-formed passages parse to the AST they were generated from',
    ({ src, ast }) => {
      const tokens = tokenizeMarkup(src);
      expectTokensTileInput(src, tokens);
      expect(normalizeAST(parseMarkup(src))).toEqual(normalizeAST(ast));
    },
    propTimeout(5),
  );

  test.prop([linkArb], fcOptions)(
    'links keep their display text and target',
    ({ src, display, target }) => {
      const tokens = tokenizeMarkup(src);
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({ type: 'link', display, target });
    },
    propTimeout(5),
  );

  // docs/macros.md `{do}`: a body that is no well-formed JavaScript up to a
  // `{/do}` in code ends at the first `{/do}`, wherever later text would
  // close its unterminated literal.
  const code = fc
    .array(fc.constantFrom(...DO_CODE), { maxLength: 4 })
    .map((parts) => parts.join(''));
  const malformedDoBody = fc
    .tuple(
      code,
      fc.constantFrom('"x', "'x", '`x', '/*x', '=/x\n', " don't", '=/[x\n'),
      code,
    )
    .map((parts) => parts.join(''));
  // What follows; its \{ is escaped, as an unclosed macro is an error.
  const tail = fc
    .array(fc.constantFrom('a', ' ', '\n', '\\{', '}', '{/do}', '{do}', '*'), {
      maxLength: 6,
    })
    .map((parts) => parts.join(''));

  test.prop([malformedDoBody, tail], fcOptions)(
    'a malformed {do} body ends at the first {/do}',
    (body, rest) => {
      const tokens = tokenizeMarkup(`{do}${body}{/do}${rest}`);
      expect(tokens[1]).toMatchObject({ type: 'text', value: body });
      expect(tokens[2]).toMatchObject({
        type: 'macro',
        name: 'do',
        isClose: true,
        start: 4 + body.length,
      });
    },
    propTimeout(5),
  );
});

describe('escaped braces (docs/markup.md "Escaped Braces")', () => {
  const opener = fc.constantFrom(
    '{$x}',
    '{_t}',
    '{@l}',
    '{%tr}',
    '{print 1}',
    '{.c $x}',
  );

  test.prop([fc.nat({ max: 12 }), opener], fcOptions)(
    'an odd backslash run escapes the brace, an even one does not',
    (n, markup) => {
      const src = `a${'\\'.repeat(n)}${markup}`;
      const ast = normalizeAST(parseMarkup(src));
      if (n % 2 === 1) {
        // The last backslash is consumed; the rest stays for markdown.
        expect(ast).toEqual([
          { type: 'text', value: `a${'\\'.repeat(n - 1)}${markup}` },
        ]);
      } else {
        expect(ast[0]).toEqual({ type: 'text', value: `a${'\\'.repeat(n)}` });
        expect(ast).toHaveLength(2);
        expect(ast[1]!.type).not.toBe('text');
      }
    },
    propTimeout(5),
  );
});

describe('text-only markup (#225)', () => {
  beforeAll(() => {
    for (const widget of TEXT_WIDGETS) {
      registerWidget(widget.name, parseMarkup(widget.body), widget.params);
    }
  });
  afterAll(() => clearWidgets());

  test.prop([pieces(3, { failing: true }), textVars, outerLocal], fcOptions)(
    'evaluates to the reference text, references kept, errors reported',
    (value, vars, outer) => {
      const locals = outer === undefined ? {} : { o: outer };
      const variables = { ...vars };
      const result = interpolateText(value.src, {
        variables,
        temporary: {},
        locals,
        transient: {},
      });
      const out = value.ref({ vars, locals }, false);
      expect(result.text, value.src).toBe(out.text);
      expect(result.errors, value.src).toHaveLength(out.errors);
      expect(variables, value.src).toEqual(vars);
    },
    propTimeout(5),
  );

  test.prop([codePieces, textVars, outerLocal], fcOptions)(
    'code attribute values resolve only their sigil references',
    (code, vars, outer) => {
      const locals = outer === undefined ? {} : { o: outer };
      const result = interpolateCode(code.src, {
        variables: { ...vars },
        temporary: {},
        locals,
        transient: {},
      });
      const out = code.ref({ vars, locals }, false);
      expect(result.text, code.src).toBe(out.text);
      expect(result.errors, code.src).toHaveLength(out.errors);
    },
    propTimeout(5),
  );
});
