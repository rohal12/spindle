import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  createScanMemo,
  scanBalancedBrace,
  tokenize,
  type Token,
} from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
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

/** One or more redundant void-element closers, which the tokenizer drops. */
const VOID_CLOSER =
  /^(?:<\/(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\s*>)+$/i;

/** The only errors buildAST may throw: messages naming a source position. */
const PARSE_ERROR =
  /^(Unexpected closing .*|Expected .* but found .*|\{.*\} without matching \{.*\}) \(at character (\d+)\)$|^Unclosed .* \(opened at character (\d+)\)$/s;

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

function expectParsesOrReportsPosition(input: string) {
  expectTextTokensTileInput(input, tokenize(input, { text: true }));
  const tokens = tokenize(input);
  expectTokensTileInput(input, tokens);
  try {
    buildAST(tokens);
  } catch (err) {
    expect(err).toBeInstanceOf(Error);
    const m = PARSE_ERROR.exec((err as Error).message);
    expect(m, (err as Error).message).not.toBeNull();
    const at = Number(m![2] ?? m![3]);
    // The reported position is the start of the offending tag or macro.
    expect(tokens.some((t) => t.start === at && t.type !== 'text')).toBe(true);
    expect('{<').toContain(input[at]);
  }
}

describe('tokenizer and AST builder robustness', () => {
  test.prop([markupNoise], fcOptions)(
    'arbitrary input tokenizes into in-order tokens covering the source',
    (input) => {
      expectParsesOrReportsPosition(input);
    },
    propTimeout(5),
  );

  // Repeating a few unclosed openers builds deep nesting of unfinished
  // constructs (`${, strings, links, tags). Before scan results were
  // memoized, nested unclosed template literals took exponential time.
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
      fc.integer({ min: 1, max: 100 }),
    )
    .map(([frags, n]) => frags.join('').repeat(n));

  test.prop([repeatedOpeners], fcOptions)(
    'repeated unclosed openers tokenize in bounded time',
    (input) => {
      const t0 = performance.now();
      try {
        buildAST(tokenize(input));
      } catch {
        // Parse errors are checked by expectParsesOrReportsPosition below.
      }
      // Generous bound: inputs are at most a few KB and take a few ms, so
      // anything slower is super-polynomial blowup, not machine noise.
      expect(performance.now() - t0).toBeLessThan(500);
      expectParsesOrReportsPosition(input);
    },
    propTimeout(5),
  );

  test.prop([mutatedPassage], fcOptions)(
    'mutated passages only fail with positioned parse errors',
    (input) => {
      expectParsesOrReportsPosition(input);
    },
    propTimeout(5),
  );
});

describe('brace scans', () => {
  test.prop([fc.oneof(markupNoise, mutatedPassage), fc.boolean()], fcOptions)(
    'answer the same with a shared memo as without',
    (input, reversed) => {
      const starts = [...Array(input.length + 1).keys()];
      if (reversed) starts.reverse();
      const memo = createScanMemo();
      for (const start of starts) {
        expect(scanBalancedBrace(input, start, memo)).toBe(
          scanBalancedBrace(input, start),
        );
      }
    },
    propTimeout(5),
  );
});

describe('tokenize running time', () => {
  /**
   * Unclosed openers whose scans would each run to the end of the passage:
   * macros and expressions in unclosed brackets, template literals, regex
   * literals and comments, and `{do}` bodies that never reach a `{/do}` in
   * code. Scans of one passage share their results.
   */
  const PATTERNS = [
    '{a',
    '{$a',
    'x {a\n',
    '{a (',
    '{a ((((]',
    '{a {$a',
    '{a `',
    '{$a`${',
    '{$a`${$a`',
    '{a "',
    "{a '} ",
    '{a /',
    '{a /[',
    '{a //',
    '{a /*',
    '{$a // `',
    '{do}/*{/do}',
    '{do}=>/`{/do}',
    // Unclosed links and {do}s, which used to search the rest each
    '[[',
    '[[a]',
    ') {a[[{a',
    '{do}',
    '{do} {/d',
    // Strings and comments that hide the next openers from earlier scans
    "'{$a'<a ",
    '"if(b="{if',
    "[[({if''",
    '{a\n//\\{$a',
    // Unclosed tags: an unquoted value takes in the next `<`, so each tag's
    // attribute scan used to run over all the tags after it
    '<a ',
    '<a x',
    '<a x=',
    '<a x=y',
    '<a a=a ',
    '<a x={',
    '<a x={$a}',
    '<a x="',
    "<a x='y' z=",
    '<a x="{$a',
    '<a x="{a"',
    '<div class=a\n',
    '<a onclick=',
    '<a x=< ',
    '</a ',
  ];

  /** Milliseconds to tokenize `src`, best of three. */
  function time(src: string): number {
    let best = Infinity;
    for (let run = 0; run < 3; run++) {
      const t0 = performance.now();
      tokenize(src);
      best = Math.min(best, performance.now() - t0);
    }
    return best;
  }

  it.each(PATTERNS)('stays about linear on %j repeated', (pattern) => {
    const small = time(pattern.repeat(500));
    const large = time(pattern.repeat(4000));
    // 8× the input may take 8× the time; allow generous noise, but not the
    // 64× of a quadratic scan.
    expect(large).toBeLessThan(Math.max(small, 0.5) * 24);
  });
});

describe('grammar round trip', () => {
  test.prop([passageArb], fcOptions)(
    'well-formed passages parse to the AST they were generated from',
    ({ src, ast }) => {
      const tokens = tokenize(src);
      expectTokensTileInput(src, tokens);
      expect(normalizeAST(buildAST(tokens))).toEqual(normalizeAST(ast));
    },
    propTimeout(5),
  );

  test.prop([linkArb], fcOptions)(
    'links keep their display text and target',
    ({ src, display, target }) => {
      const tokens = tokenize(src);
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
  const tail = fc
    .array(fc.constantFrom('a', ' ', '\n', '{', '}', '{/do}', '{do}', '*'), {
      maxLength: 6,
    })
    .map((parts) => parts.join(''));

  test.prop([malformedDoBody, tail], fcOptions)(
    'a malformed {do} body ends at the first {/do}',
    (body, rest) => {
      const tokens = tokenize(`{do}${body}{/do}${rest}`);
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
      const ast = normalizeAST(buildAST(tokenize(src)));
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
      registerWidget(
        widget.name,
        buildAST(tokenize(widget.body)),
        widget.params,
      );
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
