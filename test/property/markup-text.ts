/**
 * Arbitraries for text-only markup (HTML attribute values, #225): values
 * mixing literal text, escapes, character references, variables,
 * expressions and text macros, each with a reference evaluator giving the
 * string the value must resolve to.
 *
 * Variable names include those of Object.prototype members (`$constructor`
 * is set, `$toString` is not): they are plain variables, and one that isn't
 * set reads as missing (see src/utils/namespace.ts). With `failing`, values
 * may also use a variable named `__proto__`, which is refused with an
 * error wherever it appears.
 */
import { fc } from '@fast-check/vitest';

/** Story variables the generated markup reads. */
export interface TextVars {
  a: string;
  b: boolean;
  n: number;
  list: (string | number)[];
  o: { k: string };
  /** Named like an Object.prototype member. */
  constructor: string;
}

export interface TextEnv {
  vars: TextVars;
  /**
   * Locals without `@`: the outer loop's `o`, inner loops' item (`l` or
   * `toString`) and index (`i` or `constructor`).
   */
  locals: Record<string, unknown>;
}

/** What a piece resolves to: its text, and how many errors it reports. */
export interface TextOut {
  text: string;
  errors: number;
}

/**
 * A piece of markup and what it resolves to. `decode` says whether the
 * character references in literal text are decoded (HTML attribute values)
 * or kept (macro labels and the like).
 */
export interface TextPiece {
  src: string;
  ref: (env: TextEnv, decode: boolean) => TextOut;
}

export interface TextOptions {
  /**
   * Also generate markup that can't resolve: macros without a text form
   * (which must not run), unknown macros and failing expressions. Each
   * reports one error, where it is evaluated, and adds no text.
   */
  failing?: boolean;
}

/** Widgets the markup may invoke; tests register them with these bodies. */
export const TEXT_WIDGETS = [
  { name: 'tw', params: ['@p'], body: '[{@p}]' },
  // A parameter named like an Object.prototype member, and an unset one
  { name: 'tiw', params: ['@toString'], body: '({@toString}{@valueOf})' },
];

const show = (v: unknown) => (v == null ? '' : String(v));

const text = (t: string): TextOut => ({ text: t, errors: 0 });

const join = (outs: TextOut[]): TextOut => ({
  text: outs.map((o) => o.text).join(''),
  errors: outs.reduce((n, o) => n + o.errors, 0),
});

const concat = (pieces: TextPiece[]): TextPiece => ({
  src: pieces.map((p) => p.src).join(''),
  ref: (env, decode) => join(pieces.map((p) => p.ref(env, decode))),
});

const fixed = (src: string, out: string = src): TextPiece => ({
  src,
  ref: () => text(out),
});

const NONE: TextOut = { text: '', errors: 0 };
const FAILED: TextOut = { text: '', errors: 1 };

/**
 * Literal text. No unit ends in a backslash or contains `"` (the attribute
 * delimiter) or a bare `&`, so units resolve independently of their
 * neighbours.
 */
const literal: fc.Arbitrary<TextPiece> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc.stringMatching(/^[a-z ]{1,4}$/).map((s) => fixed(s)),
  },
  {
    weight: 3,
    arbitrary: fc
      .constantFrom(
        ...['=', '>', '<b>', '[[x]]', "'", '\n', '!', '(', ')', '#', '.'],
        ...['$a', '@l', '%t', '_t', ':', ';', '-', 'é', '}', '{3}', '{ x }'],
        ...['{"k": 1}', "{'k'}", '{[1]}', '{-1}', '{ $a }'],
      )
      .map((s) => fixed(s)),
  },
  {
    // Character references: decoded in attribute values only, and never
    // into markup (`&#123;$a}` is literal text).
    weight: 2,
    arbitrary: fc
      .constantFrom(
        ['&amp;', '&'],
        ['&lt;', '<'],
        ['&quot;', '"'],
        ['&#123;', '{'],
        ['&#123;$a}', '{$a}'],
        ['&#92;{$n}', null],
      )
      .map(
        ([src, decoded]): TextPiece =>
          decoded === null
            ? // `&#92;` decodes to a backslash, which escapes nothing.
              {
                src,
                ref: (env, decode) =>
                  text((decode ? '\\' : '&#92;') + show(env.vars.n)),
              }
            : { src, ref: (_env, decode) => text(decode ? decoded : src) },
      ),
  },
  {
    // Backslash escapes: an odd run before a brace escapes it, the run's
    // pairs show one backslash each; backslashes elsewhere are kept.
    weight: 2,
    arbitrary: fc
      .constantFrom(
        ['\\{', '{'],
        ['\\}', '}'],
        ['\\{$a}', '{$a}'],
        ['\\{if $b}x\\{/if}', '{if $b}x{/if}'],
        ['\\\\\\{', '\\{'],
        ['a\\q', 'a\\q'],
        ['\\\\q', '\\\\q'],
      )
      .map(([src, out]) => fixed(src, out)),
  },
);

type Expr = [src: string, value: (env: TextEnv) => unknown];

/** A local: own entries only, as namespaces hold them. */
const local = (env: TextEnv, name: string) =>
  Object.prototype.hasOwnProperty.call(env.locals, name)
    ? env.locals[name]
    : undefined;

/** Expressions, opened by a sigil, `(` or `!`. Strings may hold braces. */
const EXPRESSIONS: Expr[] = [
  ['$n + 1', (e) => e.vars.n + 1],
  ['!$b', (e) => !e.vars.b],
  ['($n * 2)', (e) => e.vars.n * 2],
  ['("x" + $a)', (e) => 'x' + e.vars.a],
  [`$b ? "y}" : 'n{'`, (e) => (e.vars.b ? 'y}' : 'n{')],
  ['(Math.max($n, 2))', (e) => Math.max(e.vars.n, 2)],
  ['!$list.length', (e) => !e.vars.list.length],
  ['$list.join("|")', (e) => e.vars.list.join('|')],
  ['@i + 1', (e) => (local(e, 'i') as number) + 1],
  ['(@l + "!")', (e) => String(local(e, 'l')) + '!'],
  ['!@o', (e) => !local(e, 'o')],
  ['$toString === undefined', () => true],
  [
    '($constructor + @valueOf)',
    (e) => e.vars.constructor + local(e, 'valueOf'),
  ],
  ['(typeof @hasOwnProperty)', (e) => typeof local(e, 'hasOwnProperty')],
  // Regex literals and comments hold braces and quotes; `/` after an
  // operand divides
  [`$a.replace(/[{}"']/g, "")`, (e) => e.vars.a.replace(/[{}"']/g, '')],
  [`!/[}'"]/.test($a)`, (e) => !/[}'"]/.test(e.vars.a)],
  [`$a.split(/\\}|'/).length`, (e) => e.vars.a.split(/\}|'/).length],
  [`$n /* } " ' */ + 1`, (e) => e.vars.n + 1],
  ['($n /2/ 1)', (e) => e.vars.n / 2 / 1],
];

/** Conditions for {if} / {elseif}. */
const CONDITIONS: Expr[] = [
  ['$b', (e) => e.vars.b],
  ['!$b', (e) => !e.vars.b],
  ['$n > 1', (e) => e.vars.n > 1],
  ['$a == "q"', (e) => e.vars.a === 'q'],
  ['$list.length', (e) => e.vars.list.length],
  ['@i == 0', (e) => local(e, 'i') === 0],
  [`/[{}"]/.test($a)`, (e) => /[{}"]/.test(e.vars.a)],
  [`$n > 1 /* } ' */`, (e) => e.vars.n > 1],
];

const VARIABLES: Expr[] = [
  ['$a', (e) => e.vars.a],
  ['$b', (e) => e.vars.b],
  ['$n', (e) => e.vars.n],
  ['$o.k', (e) => e.vars.o.k],
  ['$list.length', (e) => e.vars.list.length],
  ['@o', (e) => local(e, 'o')],
  ['@l', (e) => local(e, 'l')],
  ['@i', (e) => local(e, 'i')],
  ['$constructor', (e) => e.vars.constructor],
  ['$constructor.length', (e) => e.vars.constructor.length],
  ['$toString', () => undefined],
  ['_valueOf', () => undefined],
  ['%hasOwnProperty', () => undefined],
  ['@toString', (e) => local(e, 'toString')],
  ['@constructor', (e) => local(e, 'constructor')],
  ['@isPrototypeOf', () => undefined],
];

const display = ([src, value]: Expr): TextPiece => ({
  src: `{${src}}`,
  ref: (env) => text(show(value(env))),
});

/**
 * Markup that can't resolve. `{set}`, `{goto}` and the button's `{set}`
 * would change `$n` or the passage if they ran.
 */
const FAILING: string[] = [
  '{set $n = 9}',
  '{goto "Elsewhere"}',
  '{button "b"}{set $n = 9}{/button}',
  '{textbox "$a"}',
  '{nope 1}',
  '{$a.nope()}',
  '{(nosuch)}',
  '{for @l of $n}x{/for}',
  '{switch nosuch}{case 1}x{/switch}',
  // No namespace holds a variable named __proto__
  '{$__proto__}',
  '{___proto__}',
  '{%__proto__}',
  '{@__proto__}',
  '{$__proto__.x}',
  '{$__proto__ + 1}',
  '{(@__proto__)}',
  '{print $__proto__}',
  '{for @__proto__ of $list}x{/for}',
  '{for @l, @__proto__ of $list}x{/for}',
  '{if $__proto__}x{/if}',
];

/** Markup that is one `{…}` element (macros take bodies at `depth`). */
function markup(depth: number, options: TextOptions): fc.Arbitrary<TextPiece> {
  const leaves: fc.Arbitrary<TextPiece>[] = [
    fc.constantFrom(...VARIABLES).map(display),
    fc.constantFrom(...EXPRESSIONS).map(display),
    fc
      .constantFrom<Expr>(
        ['$n * 3', (e) => e.vars.n * 3],
        ['"a" + $a', (e) => 'a' + e.vars.a],
      )
      .map(([src, value]) => ({
        src: `{print ${src}}`,
        ref: (env: TextEnv) => text(show(value(env))),
      })),
    fc
      .constantFrom<Expr>(['$n', (e) => e.vars.n], ['"q"', () => 'q'])
      .map(([src, value]) => ({
        src: `{tw ${src}}`,
        ref: (env: TextEnv) => text(`[${show(value(env))}]`),
      })),
    fc
      .constantFrom<Expr>(['$constructor', (e) => e.vars.constructor])
      .map(([src, value]) => ({
        src: `{tiw ${src}}`,
        ref: (env: TextEnv) => text(`(${show(value(env))})`),
      })),
  ];
  if (options.failing) {
    leaves.push(
      fc.constantFrom(...FAILING).map((src) => ({ src, ref: () => FAILED })),
    );
  }
  if (depth <= 0) return fc.oneof(...leaves);
  const body = pieces(depth - 1, options);
  return fc.oneof(
    ...leaves,
    // {if}{elseif}…{else}{/if}
    fc
      .tuple(
        fc.array(fc.tuple(fc.constantFrom(...CONDITIONS), body), {
          minLength: 1,
          maxLength: 3,
        }),
        fc.option(body, { nil: undefined }),
      )
      .map(([branches, otherwise]) => ({
        src:
          branches
            .map(
              ([[cond], b], k) =>
                `{${k === 0 ? 'if' : 'elseif'} ${cond}}${b.src}`,
            )
            .join('') +
          (otherwise ? `{else}${otherwise.src}` : '') +
          '{/if}',
        ref: (env: TextEnv, decode: boolean) => {
          for (const [[, cond], b] of branches) {
            if (cond(env)) return b.ref(env, decode);
          }
          return otherwise ? otherwise.ref(env, decode) : NONE;
        },
      })),
    // {switch $n}{case …}…{default}…{/switch}
    fc
      .tuple(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 3 }), body), {
          minLength: 1,
          maxLength: 3,
        }),
        fc.option(body, { nil: undefined }),
      )
      .map(([cases, otherwise]) => ({
        src:
          '{switch $n}' +
          cases.map(([v, b]) => `{case ${v}}${b.src}`).join('') +
          (otherwise ? `{default}${otherwise.src}` : '') +
          '{/switch}',
        ref: (env: TextEnv, decode: boolean) => {
          const hit = cases.find(([v]) => v === env.vars.n);
          if (hit) return hit[1].ref(env, decode);
          return otherwise ? otherwise.ref(env, decode) : NONE;
        },
      })),
    // {for @l, @i of $list}…{/for}: the body sees the item and index,
    // which may be named like Object.prototype members
    fc
      .tuple(
        fc.constantFrom('l', 'toString'),
        fc.constantFrom(null, 'i', 'constructor'),
        body,
      )
      .map(([item, index, b]) => ({
        src: `{for @${item}${index ? `, @${index}` : ''} of $list}${b.src}{/for}`,
        ref: (env: TextEnv, decode: boolean) =>
          join(
            env.vars.list.map((value, i) =>
              b.ref(
                {
                  ...env,
                  locals: {
                    ...env.locals,
                    [item]: value,
                    ...(index ? { [index]: i } : {}),
                  },
                },
                decode,
              ),
            ),
          ),
      })),
    // Content wrappers: their text is their body's.
    fc.tuple(fc.constantFrom('nobr', 'span'), body).map(([name, b]) => ({
      src: `{${name}}${b.src}{/${name}}`,
      ref: b.ref,
    })),
  );
}

/** A sequence of literal text and markup. */
export function pieces(
  depth: number,
  options: TextOptions = {},
): fc.Arbitrary<TextPiece> {
  const live = markup(depth, options);
  return fc
    .array(
      fc.oneof(
        { weight: 3, arbitrary: literal },
        { weight: 3, arbitrary: live },
        // An even backslash run before markup: one backslash per pair
        // shows, and the markup stays live.
        {
          weight: 1,
          arbitrary: live.map(
            (p): TextPiece => ({
              src: `\\\\${p.src}`,
              ref: (env, decode) => join([text('\\'), p.ref(env, decode)]),
            }),
          ),
        },
      ),
      { maxLength: 5 },
    )
    .map(concat);
}

/**
 * The value of a code attribute (`onclick`, `pattern`, `srcdoc`):
 * JavaScript whose braces are code, with sigil references in it. Only the
 * references (a sigil and a word character after `{`) resolve; other
 * braces, backslashes and blocks like `{$(…)}` are kept as written, and
 * character references in the code are decoded like other attribute text.
 */
export const codePieces: fc.Arbitrary<TextPiece> = fc
  .array(
    fc.oneof(
      {
        weight: 3,
        arbitrary: fc
          .constantFrom(
            ...['if (x) ', '{return y}', 'f({a: 1})', '{alert(1)}', '{ x }'],
            ...['{if (a) {b()}}', '{set $n = 9}', '{(1)}', '{!x}', '{.a b}'],
            ...['{for (;;) {}}', ';', "'q'", "'}'", '\\', '\\{x}', 'a', ' '],
            ...['{', '}', '{nope}', '{/if}', '\n'],
          )
          .map((s) => fixed(s)),
      },
      {
        weight: 1,
        arbitrary: fc
          .constantFrom(
            ['&amp;&amp;', '&&'],
            ['&lt;', '<'],
            ['&#123;$a}', '{$a}'],
          )
          .map(
            ([src, decoded]): TextPiece => ({
              src,
              ref: (_env, decode) => text(decode ? decoded! : src!),
            }),
          ),
      },
      {
        // Kept verbatim, character references and all.
        weight: 1,
        arbitrary: fc
          .constantFrom("{$('#x')}", '{$ a}', '{%&amp;}')
          .map((s) => fixed(s)),
      },
      {
        weight: 3,
        arbitrary: fc
          .constantFrom(
            ...VARIABLES.filter(([src]) => !src.startsWith('@')),
            ['@o', (e: TextEnv) => local(e, 'o')],
            ['$n + 1', (e: TextEnv) => e.vars.n + 1],
            ["$b ? '}' : '{'", (e: TextEnv) => (e.vars.b ? '}' : '{')],
            [
              `$a.replace(/[}"']/g, '{')`,
              (e: TextEnv) => e.vars.a.replace(/[}"']/g, '{'),
            ],
            ['$list.length', (e: TextEnv) => e.vars.list.length],
            ['@toString', (e: TextEnv) => local(e, 'toString')],
            ['_constructor', () => undefined],
          )
          .map(display),
      },
      {
        weight: 1,
        arbitrary: fc
          .constantFrom(
            ...['{$a.nope()}', '{$__proto__}', '{_x + %__proto__}'],
            ...['{@__proto__.k}'],
          )
          .map((src): TextPiece => ({ src, ref: () => FAILED })),
      },
    ),
    { maxLength: 6 },
  )
  .map(concat);

const value = fc.constantFrom('q', '&amp;', '<i>', '{$n}', '', 'x y', '\\{');

export const textVars: fc.Arbitrary<TextVars> = fc.record({
  a: value,
  b: fc.boolean(),
  n: fc.integer({ min: 0, max: 3 }),
  list: fc.array(fc.oneof(value, fc.integer({ min: 0, max: 2 })), {
    maxLength: 3,
  }),
  o: fc.record({ k: value }),
  constructor: value,
});

/** The outer loop's `@o`, or none when the element is not inside a loop. */
export const outerLocal = fc.option(value, { nil: undefined });
