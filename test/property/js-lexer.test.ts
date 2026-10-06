/**
 * Property tests for the JavaScript lexer (`src/js-lexer.ts`) on arbitrary
 * input: whatever the text, it must report every character exactly once, in
 * order, and finish in about linear time.
 */
import { describe, expect, it } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  createJsScanCache,
  findCodeEnd,
  lexJs,
  lexTemplate,
  type JsGoal,
} from '../../src/js-lexer';
import { NUM_RUNS, fcOptions } from './config';
import { jsArbitraries, render } from './arbitraries/js';
import { expectAboutLinear, LINEAR_TIMEOUT } from '../support/linear-time';

/** Characters that steer the lexer's state machine. */
const LEXICAL = [
  '"',
  "'",
  '`',
  '${',
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
  '/',
  '//',
  '/*',
  '*/',
  '\\',
  '\n',
  '\r',
  '\u2028',
  ' ',
  '%',
  '%a',
  '$',
  '$x',
  '_',
  '_y',
  '@',
  '@z',
  '.',
  '...',
  '?',
  '?.',
  '??',
  ':',
  ';',
  ',',
  '=',
  '=>',
  '++',
  '--',
  '+',
  '#',
  '*',
  'a',
  '1',
  'é',
  '😀',
  '\ud800',
  'if',
  'of',
  'in',
  'get',
  'for',
  'else',
  'return',
  'typeof',
  'function',
  'class',
  'const',
];

const lexicalSoup = fc
  .array(fc.constantFrom(...LEXICAL), { maxLength: 40 })
  .map((parts) => parts.join(''));

const anyText = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 40 }),
  lexicalSoup,
);

/** Valid programs with random edits: unbalanced, unterminated, garbled. */
const sigils = jsArbitraries({ refs: true });
const mutatedProgram = fc
  .tuple(
    fc.oneof(sigils.sequence, sigils.program).map((d) => render(d, 'sigil')),
    fc.array(
      fc.tuple(fc.nat(), fc.nat({ max: 3 }), fc.constantFrom(...LEXICAL, '')),
      { minLength: 1, maxLength: 4 },
    ),
  )
  .map(([src, edits]) =>
    edits.reduce((s, [at, del, ins]) => {
      const i = s.length === 0 ? 0 : at % (s.length + 1);
      return s.slice(0, i) + ins + s.slice(i + del);
    }, src),
  );

const goal = fc.constantFrom<JsGoal>('expression', 'statements');

/**
 * Lex `src` and return what the reported pieces concatenate to, throwing if
 * a piece is out of order, overlaps or leaves a gap, or is malformed.
 */
function relex(src: string, g: JsGoal): string {
  let rebuilt = '';
  const add = (piece: string, i: number, nesting: number, ok = true) => {
    if (i !== rebuilt.length || nesting < 0 || !piece || !ok) {
      throw new Error(`bad piece ${JSON.stringify(piece)} at ${i}`);
    }
    rebuilt += piece;
  };
  const end = lexJs(
    src,
    {
      code: (ch, i, nesting) => add(ch, i, nesting, ch.length === 1),
      literal: (text, i, nesting) => add(text, i, nesting),
      variable: (sigil, name, i, nesting) =>
        add(sigil + name, i, nesting, /^\w+$/.test(name)),
    },
    g,
  );
  expect(end).toBe(src.length);
  return rebuilt;
}

describe('lexJs', () => {
  test.prop([anyText, goal], fcOptions)(
    'reports every character of arbitrary text once, in order',
    (src, g) => {
      expect(relex(src, g)).toBe(src);
    },
  );

  test.prop([mutatedProgram, goal], fcOptions)(
    'reports every character of a garbled program once, in order',
    (src, g) => {
      expect(relex(src, g)).toBe(src);
    },
  );

  test.prop([fc.string({ unit: 'binary', maxLength: 30 })], fcOptions)(
    'never reports a variable inside a string literal',
    (text) => {
      const src = JSON.stringify(text);
      let variables = 0;
      lexJs(src, { variable: () => variables++ });
      expect(variables).toBe(0);
    },
  );
});

describe('lexTemplate', () => {
  test.prop([anyText], fcOptions)(
    'reports a template literal’s characters once and stops after it',
    (text) => {
      const src = '`' + text;
      let rebuilt = '';
      const end = lexTemplate(src, 0, {
        code: (ch) => (rebuilt += ch),
        literal: (t) => (rebuilt += t),
        variable: (sigil, name) => (rebuilt += sigil + name),
      });
      expect(end).toBeGreaterThan(0);
      expect(end).toBeLessThanOrEqual(src.length);
      expect(rebuilt).toBe(src.slice(0, end));
    },
  );
});

describe('findCodeEnd', () => {
  const DO_CLOSER = '{/do}';
  const atCloser = (src: string) => (i: number) => src.startsWith(DO_CLOSER, i);

  /** A valid expression or statement list, with its goal. */
  const validCode = fc.oneof(
    sigils.sequence.map((d) => ({
      code: render(d, 'sigil'),
      g: 'expression' as const,
    })),
    sigils.program.map((d) => ({
      code: render(d, 'sigil'),
      g: 'statements' as const,
    })),
  );

  test.prop([validCode, anyText], fcOptions)(
    'finds the } closing valid code, whatever its literals and comments hold',
    ({ code, g }, tail) => {
      // A line break ends a trailing `//` comment, as it would in a block.
      const src = `${code}\n}${tail}`;
      expect(findCodeEnd(src, 0, { goal: g })).toBe(code.length + 1);
    },
  );

  test.prop([sigils.program, anyText], fcOptions)(
    'finds the stop after valid statements',
    (doc, tail) => {
      const code = render(doc, 'sigil');
      fc.pre(!code.includes(DO_CLOSER));
      const src = `${code}\n${DO_CLOSER}${tail}`;
      const end = findCodeEnd(src, 0, {
        goal: 'statements',
        stop: atCloser(src),
      });
      expect(end).toBe(code.length + 1);
    },
  );

  /** Text with many starts, closers and `{/do}`s to share results across. */
  const scanText = fc.oneof(
    anyText,
    mutatedProgram,
    fc
      .array(fc.constantFrom(...LEXICAL, '{/do}', '{a ', '}', '{'), {
        maxLength: 60,
      })
      .map((parts) => parts.join('')),
    // A few tokens repeated: scans from the repeats pass the same points
    // and frames, in the same or in different states
    fc
      .tuple(
        fc.array(fc.constantFrom(...LEXICAL, '{/do}', '{a '), {
          minLength: 1,
          maxLength: 6,
        }),
        fc.integer({ min: 2, max: 8 }),
      )
      .map(([parts, n]) => parts.join('').repeat(n)),
    // A function or class whose brackets hold functions and classes, then
    // a `/` that is a regex after a block but division after a function
    // expression: whether a `{` opens a function body depends on the code
    // before it, inside the brackets too
    fc
      .tuple(
        fc.constantFrom('', 'x =', 'return', '(', '{'),
        fc.constantFrom('function f(', 'function (', 'class A extends ('),
        fc.array(
          fc.constantFrom(
            ...['function(){}', 'function g() {', 'class {}', 'class', '}'],
            ...['a', '=', ',', '(', ')', '[', ']', '{', '=>', '/'],
          ),
          { maxLength: 6 },
        ),
        fc.constantFrom(') {}', ')', ') {', ''),
        fc.constantFrom('/}/ }', '/ 1 /', '}', ''),
      )
      .map(([a, b, inner, c, d]) => [a, b, ...inner, c, d].join(' ')),
  );

  // Scans share results within brackets only once they are long, which
  // the short text here never is unless `shareAll` lifts that limit.
  test.prop([scanText, fc.boolean(), fc.boolean()], fcOptions)(
    'answers the same with a shared cache as without',
    (src, reversed, shareAll) => {
      const starts = [...Array(src.length + 1).keys()];
      if (reversed) starts.reverse();
      const cache = createJsScanCache();
      if (shareAll) cache.shareAfter = 0;
      const stop = atCloser(src);
      const opts = { goal: 'statements' as const, stop };
      const shared = starts.map((start) => [
        findCodeEnd(src, start, { cache }),
        findCodeEnd(src, start, { ...opts, stopKey: 'do', cache }),
      ]);
      const fresh = starts.map((start) => [
        findCodeEnd(src, start),
        findCodeEnd(src, start, opts),
      ]);
      expect(shared).toEqual(fresh);
    },
    // Each run scans from every start, so its time grows with the square of
    // the text's length and varies widely between seeds; coverage
    // instrumentation in CI makes it several times slower again
    Math.max(LINEAR_TIMEOUT, NUM_RUNS * 300),
  );
});

describe('findCodeEnd running time', { timeout: LINEAR_TIMEOUT }, () => {
  /**
   * Code scanned from many starts with a shared cache, as the tokenizer
   * scans the `{` blocks of a passage: scans that each ran on to the end of
   * the source, never meeting a point an earlier scan passed in the same
   * state. Each pattern's code starts just past `@`.
   */
  const PATTERNS = [
    // Inside an unclosed `(`: no point within brackets was shared
    '@(}{',
    '@( a[[}',
    '@(<a x="}',
    // After regex literals with flags: no point after a space was shared
    "@ </p>{a'</a",
    '@ </b>',
  ];

  /** Scan `src` from each `@` with one fresh shared cache. */
  function scanAll(src: string): () => void {
    const starts: number[] = [];
    for (let i = src.indexOf('@'); i !== -1; i = src.indexOf('@', i + 1)) {
      starts.push(i + 1);
    }
    return () => {
      const cache = createJsScanCache();
      for (const start of starts) findCodeEnd(src, start, { cache });
    };
  }

  it.each(PATTERNS)('stays about linear on %j repeated', (pattern) => {
    // 8× the input may take about 8× the time, not a quadratic scan's 64×
    expectAboutLinear(
      scanAll(pattern.repeat(500)),
      scanAll(pattern.repeat(4000)),
    );
  });
});

describe('lexJs running time', { timeout: LINEAR_TIMEOUT }, () => {
  /**
   * Inputs that make a lexer backtrack or rescan: nested unterminated
   * literals and brackets, and `%name` assignments starting lines (which
   * look ahead over the target's member chain).
   */
  const PATTERNS = [
    '`${',
    '"\\',
    '/[',
    '/*',
    '{',
    '([{',
    'x\n%a[',
    'x\n%a.b',
    'x\n%a [ x\n%a[0] ] = 1\n',
    '{ get ',
    'class C { _x = 1\n',
    'a ? b : ',
    '%a %b ',
    '$a.$b._c ',
  ];

  const lex = (src: string) => () =>
    lexJs(src, { code() {}, literal() {}, variable() {} });

  it.each(PATTERNS)('stays about linear on %j repeated', (pattern) => {
    // 8× the input may take about 8× the time, not a quadratic scan's 64×
    expectAboutLinear(lex(pattern.repeat(500)), lex(pattern.repeat(4000)));
  });
});
