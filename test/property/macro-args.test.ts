/**
 * Property tests for macro argument splitting (#200, #224, #201): the
 * splitters built on the shared lexer (`arg-utils.ts`) must cut any list of
 * valid argument expressions back into exactly those expressions.
 */
import { describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { fcOptions } from './config';
import {
  EXPR_ENV,
  exprArbs,
  quotedLabel,
  regexLiteral,
} from './js-arbitraries';
import type { Expr } from './js-arbitraries';
import { splitArgs } from '../../src/components/macros/WidgetInvocation';
import {
  parseMeterArgs,
  parseIncludeArgs,
  parseWatchArgs,
  parseUnwatchName,
  parseCheckboxLabel,
  parseRadioArgs,
  parseLinkArgs,
} from '../support/macro-args';
import {
  parseVarArgs,
  extractOptions,
} from '../../src/components/macros/option-utils';
import { readWholeQuoted } from '../../src/components/macros/arg-utils';
import type { ASTNode } from '../../src/markup/ast';
import { evaluate } from '../../src/expression';

const { any, standalone } = exprArbs();

function evalInEnv(src: string): unknown {
  const { variables, temporary, locals, transient } = EXPR_ENV;
  return evaluate(src, variables, temporary, locals, transient);
}

/** Separators between comma-form arguments. */
const commaSep = fc
  .tuple(
    fc.constantFrom('', ' ', '\t', '\n'),
    fc.constantFrom('', ' ', '  ', '\n'),
  )
  .map(([before, after]) => `${before},${after}`);

/** Separators between whitespace-form arguments. */
const spaceSep = fc.constantFrom(' ', '  ', '\t', '\n', ' \n ');

function joinWith(exprs: Expr[], seps: string[]): string {
  return exprs.map((e, i) => (i === 0 ? e.src : seps[i - 1]! + e.src)).join('');
}

const commaList = fc.array(any, { minLength: 2, maxLength: 5 }).chain((exprs) =>
  fc
    .array(commaSep, {
      minLength: exprs.length - 1,
      maxLength: exprs.length - 1,
    })
    .map((seps) => ({ exprs, raw: joinWith(exprs, seps) })),
);

const spaceList = fc
  .array(standalone, { minLength: 2, maxLength: 5 })
  .chain((exprs) =>
    fc
      .array(spaceSep, {
        minLength: exprs.length - 1,
        maxLength: exprs.length - 1,
      })
      .map((seps) => ({ exprs, raw: joinWith(exprs, seps) })),
  );

describe('splitArgs (widget arguments)', () => {
  test.prop([commaList], fcOptions)(
    'comma form returns exactly the generated expressions',
    ({ exprs, raw }) => {
      expect(splitArgs(raw)).toEqual(exprs.map((e) => e.src));
    },
  );

  test.prop([commaList], fcOptions)(
    'comma form arguments evaluate to the generated values',
    ({ exprs, raw }) => {
      expect(splitArgs(raw).map(evalInEnv)).toEqual(exprs.map((e) => e.value));
    },
  );

  test.prop([commaList], fcOptions)(
    'a trailing comma adds no argument',
    ({ exprs, raw }) => {
      expect(splitArgs(`${raw},`)).toEqual(exprs.map((e) => e.src));
    },
  );

  test.prop([spaceList], fcOptions)(
    'whitespace form returns exactly the generated standalone arguments',
    ({ exprs, raw }) => {
      expect(splitArgs(raw)).toEqual(exprs.map((e) => e.src));
    },
  );

  test.prop([spaceList], fcOptions)(
    'whitespace form arguments evaluate to the generated values',
    ({ exprs, raw }) => {
      expect(splitArgs(raw).map(evalInEnv)).toEqual(exprs.map((e) => e.value));
    },
  );

  test.prop([any], fcOptions)(
    'a single expression with spaced operators stays one argument',
    (e) => {
      expect(splitArgs(e.src)).toEqual([e.src]);
      expect(evalInEnv(e.src)).toEqual(e.value);
    },
  );
});

describe('parseMeterArgs', () => {
  const current = fc.oneof(standalone, regexStartCurrent());
  // A max expression starting with a regex literal reads as division after
  // the current value; docs/macros.md says to wrap it in parentheses.
  const max = any.filter((e) => !e.src.startsWith('/'));

  /** Current, max and optional label, with random whitespace between. */
  const meterArgs = fc
    .tuple(
      current,
      max,
      fc.option(quotedLabel(), { nil: undefined }),
      spaceSep,
      spaceSep,
    )
    // A max that is one quoted string with no label is the documented
    // `{meter $hp "HP"}` error case.
    .filter(([, m, label]) => label !== undefined || !isWholeString(m.src))
    .map(([cur, m, label, s1, s2]) => ({
      cur,
      max: m,
      label,
      raw: cur.src + s1 + m.src + (label ? s2 + label.quoted : ''),
    }));

  test.prop([meterArgs], fcOptions)(
    'reads back the current and max expressions and the label',
    ({ cur, max, label, raw }) => {
      expect(parseMeterArgs(raw)).toEqual({
        currentExpr: cur.src,
        maxExpr: max.src,
        labelMode: label?.text ?? '',
      });
    },
  );

  test.prop([meterArgs], fcOptions)(
    'the expressions evaluate to the generated values',
    ({ cur, max, raw }) => {
      const { currentExpr, maxExpr } = parseMeterArgs(raw);
      expect(evalInEnv(currentExpr)).toEqual(cur.value);
      expect(evalInEnv(maxExpr)).toEqual(max.value);
    },
  );
});

describe('parseIncludeArgs', () => {
  const ws = fc.constantFrom(' ', '  ', '\t', '\n');

  test.prop([any, ws], fcOptions)(
    'a trailing inline flag is split off any expression',
    (e, sp) => {
      expect(parseIncludeArgs(`${e.src}${sp}inline`)).toEqual({
        nameExpr: e.src,
        inline: true,
      });
    },
  );

  // After a leading flag, a `+`, `-` or `/` reads as a binary operator
  // (`inline - 1`), as the flag's docs say: those starts are excluded.
  const leadable = any.filter((e) => !/^[-+/]/.test(e.src));

  test.prop([leadable, ws], fcOptions)(
    'a leading inline flag is split off any expression',
    (e, sp) => {
      expect(parseIncludeArgs(`inline${sp}${e.src}`)).toEqual({
        nameExpr: e.src,
        inline: true,
      });
    },
  );

  test.prop([any], fcOptions)('no flag leaves the expression whole', (e) => {
    expect(parseIncludeArgs(e.src)).toEqual({
      nameExpr: e.src,
      inline: false,
    });
  });
});

describe('parseWatchArgs', () => {
  const keys = ['goto', 'dialog', 'run', 'name', 'priority', 'once'] as const;
  interface WatchOption {
    key: (typeof keys)[number];
    src: string;
    value: unknown;
  }
  const option = fc.constantFrom(...keys).chain((key) => {
    if (key === 'once')
      return fc.constant<WatchOption>({ key, src: 'once', value: true });
    if (key === 'priority')
      return fc
        .nat({ max: 10_000 })
        .map((n): WatchOption => ({ key, src: `priority ${n}`, value: n }));
    return fc.tuple(quotedLabel(), spaceSep).map(([l, sp]): WatchOption => ({
      key,
      src: key + sp + l.quoted,
      value: l.text,
    }));
  });

  const watchArgs = fc
    .tuple(
      quotedLabel(),
      fc.uniqueArray(option, { selector: (o) => o.key, maxLength: 6 }),
      fc.array(spaceSep, { minLength: 6, maxLength: 6 }),
    )
    .map(([cond, opts, seps]) => ({
      cond,
      opts,
      raw: cond.quoted + opts.map((o, i) => seps[i]! + o.src).join(''),
    }));

  test.prop([watchArgs], fcOptions)(
    'reads back the condition and every option',
    ({ cond, opts, raw }) => {
      expect(parseWatchArgs(raw)).toEqual({
        condition: cond.text,
        options: Object.fromEntries(opts.map((o) => [o.key, o.value])),
      });
    },
  );
});

describe('quoted literal arguments decode the same in every macro (#200)', () => {
  const label = quotedLabel();

  test.prop([label], fcOptions)('meter label', ({ text, quoted }) => {
    expect(parseMeterArgs(`$hp 100 ${quoted}`).labelMode).toBe(text);
  });

  test.prop([label], fcOptions)(
    'watch condition, option values and unwatch name',
    ({ text, quoted }) => {
      expect(parseWatchArgs(quoted)?.condition).toBe(text);
      for (const key of ['goto', 'dialog', 'run', 'name'] as const) {
        expect(parseWatchArgs(`"$x" ${key} ${quoted}`)?.options[key]).toBe(
          text,
        );
      }
      expect(parseUnwatchName(quoted)).toBe(text);
    },
  );

  test.prop([label], fcOptions)('input placeholder', ({ text, quoted }) => {
    expect(parseVarArgs(`$name ${quoted}`)).toEqual({
      varName: '$name',
      placeholder: text,
    });
  });

  test.prop([label], fcOptions)('option value', ({ text, quoted }) => {
    const node: ASTNode = {
      type: 'macro',
      name: 'option',
      rawArgs: quoted,
      children: [],
    } as unknown as ASTNode;
    expect(extractOptions([node])).toEqual([text]);
  });

  test.prop([label], fcOptions)('checkbox label', ({ text, quoted }) => {
    expect(parseCheckboxLabel(`$agree ${quoted}`)).toBe(text);
  });

  test.prop([label, label], fcOptions)(
    'radiobutton value and label',
    (value, lab) => {
      expect(parseRadioArgs(`$color ${value.quoted} ${lab.quoted}`)).toEqual({
        value: value.text,
        label: lab.text,
      });
      expect(parseRadioArgs(`$color ${value.quoted}`).value).toBe(value.text);
    },
  );

  test.prop([label, label], fcOptions)(
    'link text and passage',
    (display, passage) => {
      expect(parseLinkArgs(`${display.quoted} ${passage.quoted}`)).toEqual({
        display: display.text,
        passage: passage.text,
      });
      expect(parseLinkArgs(display.quoted)).toEqual({
        display: display.text,
        passage: null,
      });
    },
  );
});

/** Whether `src` is exactly one `"…"` or `'…'` string literal. */
function isWholeString(src: string): boolean {
  return readWholeQuoted(src) !== null;
}

/** A current-value argument that starts with a regex literal. */
function regexStartCurrent(): fc.Arbitrary<Expr> {
  return regexLiteral.map((re) => ({
    src: `${re.src}.test($s)`,
    value: (re.value as RegExp).test(EXPR_ENV.variables.s as string),
    primary: true,
  }));
}
