/**
 * Property tests for the JavaScript lexer (`src/js-lexer.ts`) on arbitrary
 * input: whatever the text, it must report every character exactly once, in
 * order, and finish in about linear time.
 */
import { describe, expect, it } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  findCodeEnd,
  lexJs,
  lexTemplate,
  type JsGoal,
} from '../../src/js-lexer';
import { fcOptions } from './config';
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
