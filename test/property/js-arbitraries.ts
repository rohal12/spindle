/**
 * Arbitraries for JavaScript argument expressions, paired with the value
 * each one evaluates to in a fixed environment (`EXPR_ENV`).
 *
 * Every generated expression is valid JavaScript for the expression engine
 * (`evaluate` in src/expression.ts) and its `value` is computed alongside the
 * source text, so properties can check both how macro argument splitters cut
 * a list of expressions and what each piece evaluates to.
 */
import { fc } from '@fast-check/vitest';

export interface Expr {
  /** Source text, never with leading or trailing whitespace. */
  src: string;
  /** What `src` evaluates to in `EXPR_ENV`. */
  value: unknown;
  /**
   * A primary expression (literal, variable, call, member access, bracket
   * or paren group): usable as an operand without parentheses.
   */
  primary: boolean;
  /** The source starts with an object literal's `{`. */
  objectStart?: boolean;
}

export interface ExprOptions {
  /** Sigils to reference variables with (default: all four). */
  sigils?: readonly ('$' | '_' | '@' | '%')[];
  /** Generate regex literals (default true). */
  regex?: boolean;
  /** Put block comments around binary operators (default true). */
  comments?: boolean;
  /** Generate raw and escaped line breaks inside literals (default true). */
  newlines?: boolean;
  /** Maximum nesting depth (default 3). */
  depth?: number;
}

const identity = (x: unknown) => x;

/** The variables every generated expression may reference. */
export const EXPR_ENV = {
  variables: {
    a: 3,
    b: -2.5,
    s: 'hi, "there" (x)',
    list: [1, 'two', [3]],
    obj: { k: 'v', 'sp ace': 1, n: { m: 2 } },
    flag: true,
    f: identity,
  } as Record<string, unknown>,
  temporary: { t: 7, u: 'x y' } as Record<string, unknown>,
  locals: { item: 'loc', n: 4 } as Record<string, unknown>,
  transient: { tr: 9 } as Record<string, unknown>,
};

const { variables: V, temporary: T, locals: L, transient: TR } = EXPR_ENV;

const VAR_REFS: Record<string, { src: string; value: unknown }[]> = {
  $: [
    { src: '$a', value: V.a },
    { src: '$b', value: V.b },
    { src: '$s', value: V.s },
    { src: '$list', value: V.list },
    { src: '$obj', value: V.obj },
    { src: '$flag', value: V.flag },
    { src: '$obj.k', value: 'v' },
    { src: '$obj["sp ace"]', value: 1 },
    { src: '$obj.n.m', value: 2 },
    { src: '$list[1]', value: 'two' },
    { src: '$s.length', value: (V.s as string).length },
  ],
  _: [
    { src: '_t', value: T.t },
    { src: '_u', value: T.u },
  ],
  '@': [
    { src: '@item', value: L.item },
    { src: '@n', value: L.n },
  ],
  '%': [{ src: '%tr', value: TR.tr }],
};

type Unit = readonly [value: string, src: string];

const PLAIN_CHARS = [
  'a',
  'b',
  'Z',
  '0',
  ' ',
  ',',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '/',
  '*',
  '+',
  '-',
  '!',
  '?',
  ':',
  ';',
  '=',
  '<',
  '>',
  '$',
  '_',
  '@',
  '%',
  '#',
  '.',
  'é',
  '😀',
  '\t',
];

function quoteUnits(quote: '"' | "'", opts: ExprOptions): fc.Arbitrary<Unit> {
  const other = quote === '"' ? "'" : '"';
  const raw: Unit[] = [...PLAIN_CHARS, other, '`'].map((c) => [c, c]);
  const escapes: Unit[] = [
    [quote, `\\${quote}`],
    [other, `\\${other}`],
    ['\\', '\\\\'],
    ['\t', '\\t'],
    ['A', '\\x41'],
    ['é', '\\u00e9'],
    ['😀', '\\u{1F600}'],
    ['/', '\\/'],
    ['$', '\\$'],
  ];
  if (opts.newlines !== false) {
    escapes.push(['\n', '\\n'], ['\r', '\\r'], ['', '\\\n']);
  }
  return fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...raw) },
    { weight: 2, arbitrary: fc.constantFrom(...escapes) },
  );
}

/** A `"…"` or `'…'` string literal with random content and escapes. */
export function stringLiteral(opts: ExprOptions = {}): fc.Arbitrary<Expr> {
  return fc.constantFrom('"' as const, "'" as const).chain((q) =>
    fc.array(quoteUnits(q, opts), { maxLength: 10 }).map((units) => ({
      src: q + units.map((u) => u[1]).join('') + q,
      value: units.map((u) => u[0]).join(''),
      primary: true,
    })),
  );
}

function templateTextUnits(opts: ExprOptions): fc.Arbitrary<Unit> {
  const raw: Unit[] = [...PLAIN_CHARS.filter((c) => c !== '$'), '"', "'"].map(
    (c) => [c, c],
  );
  // A `$` not followed by `{` is text.
  raw.push(['$x', '$x'], ['$ ', '$ ']);
  const escapes: Unit[] = [
    ['`', '\\`'],
    ['\\', '\\\\'],
    ['$', '\\$'],
    ['${', '\\${'],
    ['${', '$\\{'],
    ['\t', '\\t'],
  ];
  if (opts.newlines !== false) {
    raw.push(['\n', '\n']);
    escapes.push(['\r', '\\r'], ['\n', '\\n']);
  }
  return fc.oneof(
    { weight: 3, arbitrary: fc.constantFrom(...raw) },
    { weight: 2, arbitrary: fc.constantFrom(...escapes) },
  );
}

const REGEX_PIECES = [
  'a',
  'b',
  ' ',
  ',',
  '"',
  "'",
  '`',
  '{',
  '}',
  '$',
  'x+',
  '\\/',
  '\\\\',
  '\\d',
  '\\(',
  '\\)',
  '\\[',
  '\\]',
  '\\{',
  '\\}',
  '[/"\' ,)(]',
  '[^\\]/]',
  '[`]',
  '(?:a|,)',
];

/** A regex literal (`/…/flags`) whose body holds quotes, slashes and brackets. */
export const regexLiteral: fc.Arbitrary<Expr> = fc
  .tuple(
    fc.array(fc.constantFrom(...REGEX_PIECES), { minLength: 1, maxLength: 6 }),
    fc.subarray(['g', 'i', 'm', 's', 'y']),
  )
  .map(([pieces, flags]) => {
    const body = pieces.join('');
    const flagStr = flags.join('');
    return {
      src: `/${body}/${flagStr}`,
      value: new RegExp(body, flagStr),
      primary: true,
    };
  });

const numberLiteral: fc.Arbitrary<Expr> = fc
  .oneof(
    fc.nat({ max: 1_000_000 }).map(String),
    fc
      .double({ min: 0, max: 1e30, noNaN: true, noDefaultInfinity: true })
      .map((d) => String(Math.abs(d))),
    fc.nat({ max: 0xffff }).map((n) => `0x${n.toString(16)}`),
    fc.nat({ max: 999 }).map((n) => `1_${String(n).padStart(3, '0')}`),
    fc.nat({ max: 99 }).map((n) => `${n}e3`),
  )
  .map((src) => ({
    src,
    value: Number(src.replace(/_/g, '')),
    primary: true,
  }));

const bigintLiteral: fc.Arbitrary<Expr> = fc
  .bigInt({ min: 0n, max: 10n ** 20n })
  .map((n) => ({ src: `${n}n`, value: n, primary: true }));

const keywordLiteral: fc.Arbitrary<Expr> = fc.constantFrom<Expr>(
  { src: 'true', value: true, primary: true },
  { src: 'false', value: false, primary: true },
  { src: 'null', value: null, primary: true },
  { src: 'undefined', value: undefined, primary: true },
);

function varRef(opts: ExprOptions): fc.Arbitrary<Expr> {
  const sigils = opts.sigils ?? ['$', '_', '@', '%'];
  const refs = sigils.flatMap((s) => VAR_REFS[s]!);
  return fc.constantFrom(...refs).map((r) => ({ ...r, primary: true }));
}

/** Evaluate `fn` as JavaScript would; `null` when it throws (e.g. BigInt mixing). */
function tryValue(fn: () => unknown): { value: unknown } | null {
  try {
    return { value: fn() };
  } catch {
    return null;
  }
}

const BINARY_OPS: Record<string, (a: any, b: any) => unknown> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '%': (a, b) => a % b,
  '**': (a, b) => a ** b,
  '<': (a, b) => a < b,
  '>=': (a, b) => a >= b,
  '==': (a, b) => a == b,
  '===': (a, b) => a === b,
  '!=': (a, b) => a != b,
  '!==': (a, b) => a !== b,
  '&&': (a, b) => a && b,
  '||': (a, b) => a || b,
  '??': (a, b) => a ?? b,
  '&': (a, b) => a & b,
  '|': (a, b) => a | b,
  '<<': (a, b) => a << b,
};

const UNARY_OPS: Record<string, (a: any) => unknown> = {
  '-': (a) => -a,
  '+': (a) => +a,
  '!': (a) => !a,
  '~': (a) => ~a,
  'typeof ': (a) => typeof a,
  'void ': () => undefined,
};

/** Whether `left + right` would fuse into a different token. */
function needsSpace(left: string, right: string): boolean {
  const l = left.slice(-1);
  const r = right[0] ?? '';
  if (/[\w$]/.test(l) && /[\w$]/.test(r)) return true;
  if ((l === '+' || l === '-') && r === l) return true; // ++ / --
  if (l === '/' && (r === '/' || r === '*')) return true; // comment
  if (l === '<' && right.startsWith('!--')) return true; // <!--
  return false;
}

function join(left: string, right: string): string {
  return needsSpace(left, right) ? `${left} ${right}` : left + right;
}

const OBJECT_KEYS = ['k', 'x', 'key', 'in', 'of', 'Z9'];

export interface ExprArbs {
  /** Any expression without a top-level comma. */
  any: fc.Arbitrary<Expr>;
  /** A primary expression (see `Expr.primary`). */
  primary: fc.Arbitrary<Expr>;
  /**
   * A standalone argument for the whitespace-separated form of widget
   * arguments (docs/widgets.md): no whitespace outside literals and
   * brackets, and starting with a quote, sigil, digit, sign + digit, bracket,
   * `!`, or `true`/`false`/`null`/`undefined`.
   */
  standalone: fc.Arbitrary<Expr>;
  string: fc.Arbitrary<Expr>;
  template: fc.Arbitrary<Expr>;
}

export function exprArbs(opts: ExprOptions = {}): ExprArbs {
  const maxDepth = opts.depth ?? 3;
  const string = stringLiteral(opts);
  const variable = varRef(opts);
  const regex = opts.regex === false ? null : regexLiteral;
  const spacing = fc.constantFrom(
    '',
    ' ',
    '  ',
    ...(opts.newlines === false ? [] : ['\n']),
  );
  const opSpacing = fc.constantFrom(
    '',
    ' ',
    ...(opts.comments === false ? [] : [' /* , ) " ` */ ']),
  );

  const atoms: fc.Arbitrary<Expr>[] = [
    string,
    numberLiteral,
    bigintLiteral,
    keywordLiteral,
    variable,
  ];
  if (regex) atoms.push(regex);
  const atom = fc.oneof(...atoms);

  const memo = new Map<string, fc.Arbitrary<Expr>>();
  function cached(
    kind: string,
    depth: number,
    make: () => fc.Arbitrary<Expr>,
  ): fc.Arbitrary<Expr> {
    const key = `${kind}:${depth}`;
    let arb = memo.get(key);
    if (!arb) {
      arb = make();
      memo.set(key, arb);
    }
    return arb;
  }

  function template(depth: number): fc.Arbitrary<Expr> {
    return cached('template', depth, () => {
      const units: fc.Arbitrary<Unit>[] = [templateTextUnits(opts)];
      if (depth > 0) {
        units.push(
          fc
            .tuple(any(depth - 1), spacing)
            .map(([e, sp]) => [String(e.value), `\${${sp}${e.src}${sp}}`]),
        );
      }
      return fc.array(fc.oneof(...units), { maxLength: 6 }).map((parts) => ({
        src: '`' + parts.map((u) => u[1]).join('') + '`',
        value: parts.map((u) => u[0]).join(''),
        primary: true,
      }));
    });
  }

  function primary(depth: number): fc.Arbitrary<Expr> {
    return cached('primary', depth, () => {
      if (depth <= 0) return fc.oneof(atom, template(0));
      const sub = any(depth - 1);
      const items = fc.array(sub, { maxLength: 4 });
      const sep = fc.tuple(spacing, spacing).map(([a, b]) => `${a},${b}`);
      const array = fc
        .tuple(items, sep, fc.boolean())
        .map(([es, s, trailing]) => ({
          src: `[${es.map((e) => e.src).join(s)}${trailing && es.length ? ',' : ''}]`,
          value: es.map((e) => e.value),
          primary: true,
        }));
      const key = fc.oneof(
        fc.constantFrom(...OBJECT_KEYS).map((k) => ({ src: k, name: k })),
        string
          .filter((s) => s.value !== '__proto__')
          .map((s) => ({ src: s.src, name: s.value as string })),
        fc.nat({ max: 99 }).map((n) => ({ src: String(n), name: String(n) })),
      );
      const object = fc
        .tuple(fc.array(fc.tuple(key, sub), { maxLength: 3 }), sep, spacing)
        .map(([entries, s, sp]) => {
          const value: Record<string, unknown> = {};
          for (const [k, e] of entries) value[k.name] = e.value;
          return {
            src: `{${sp}${entries.map(([k, e]) => `${k.src}: ${e.src}`).join(s)}${sp}}`,
            value,
            primary: true,
            objectStart: true,
          };
        });
      const paren = fc.tuple(sub, spacing).map(([e, sp]) => ({
        src: `(${sp}${e.src}${sp})`,
        value: e.value,
        primary: true,
      }));
      const call = fc.oneof(
        sub.map((e) => ({
          src: `String(${e.src})`,
          value: String(e.value),
          primary: true,
        })),
        fc.tuple(sub, sub, sep).chain(([x, y, s]): fc.Arbitrary<Expr> => {
          const v = tryValue(() => Math.max(x.value as any, y.value as any));
          return v
            ? fc.constant({
                src: `Math.max(${x.src}${s}${y.src})`,
                value: v.value,
                primary: true,
              })
            : fc.constant({ src: `(${x.src})`, value: x.value, primary: true });
        }),
        sub.map((e) => ({
          src: `((x) => x)(${e.src})`,
          value: e.value,
          primary: true,
        })),
        fc.tuple(items, fc.nat({ max: 4 })).map(([es, i]) => ({
          src: `[${es.map((e) => e.src).join(', ')}][${i}]`,
          value: es.map((e) => e.value)[i],
          primary: true,
        })),
      );
      const fnCall =
        opts.sigils && !opts.sigils.includes('$')
          ? []
          : [
              sub.map((e) => ({
                src: `$f(${e.src})`,
                value: e.value,
                primary: true,
              })),
            ];
      return fc.oneof(
        { depthSize: 'small' },
        atom,
        template(depth),
        array,
        object,
        paren,
        call,
        ...fnCall,
      );
    });
  }

  /** Unary or primary: binds tighter than any binary operator. */
  function operand(depth: number): fc.Arbitrary<Expr> {
    return cached('operand', depth, () => {
      const p = primary(depth);
      const unary = fc
        .tuple(fc.constantFrom(...Object.keys(UNARY_OPS)), p)
        .chain(([op, e]) => {
          const v = tryValue(() => UNARY_OPS[op]!(e.value));
          if (!v) return fc.constant(e);
          return fc.constant<Expr>({
            src: join(op, e.src),
            value: v.value,
            primary: false,
          });
        });
      return fc.oneof(p, unary);
    });
  }

  function any(depth: number): fc.Arbitrary<Expr> {
    return cached('any', depth, () => {
      const left = operand(depth).map((e) =>
        e.objectStart
          ? // An object literal directly before an operator reads as a
            // block to the shared lexer (it also lexes statements), so
            // `{…} / 2` is excluded; it is NaN in any case.
            { ...e, src: `(${e.src})`, primary: true, objectStart: false }
          : e,
      );
      const binary = fc
        .tuple(
          left,
          fc.constantFrom(...Object.keys(BINARY_OPS)),
          operand(depth),
          opSpacing,
        )
        .chain(([l, op, r, sp]) => {
          // `-x ** y` is a syntax error
          if (op === '**' && !l.primary) return fc.constant(l);
          const v = tryValue(() => BINARY_OPS[op]!(l.value, r.value));
          if (!v) return fc.constant(l);
          return fc.constant<Expr>({
            src: join(join(l.src + sp, op) + sp, r.src),
            value: v.value,
            primary: false,
          });
        });
      const inObj = (opts.sigils ?? ['$']).includes('$')
        ? [
            string.map((k) => ({
              src: `${k.src} in $obj`,
              value: (k.value as string) in (V.obj as object),
              primary: false,
            })),
          ]
        : [];
      if (depth <= 0) return fc.oneof(operand(depth), binary);
      const ternary = fc
        .tuple(operand(depth), any(depth - 1), any(depth - 1))
        .map(([c, a, b]) => ({
          src: `${c.src} ? ${a.src} : ${b.src}`,
          value: c.value ? a.value : b.value,
          primary: false,
        }));
      return fc.oneof(
        { depthSize: 'small' },
        operand(depth),
        binary,
        ternary,
        ...inObj,
      );
    });
  }

  function standalone(depth: number): fc.Arbitrary<Expr> {
    const head = fc.oneof(
      string,
      template(depth),
      numberLiteral.filter((e) => /^\d/.test(e.src)),
      bigintLiteral,
      variable,
      keywordLiteral,
      primary(depth).filter((e) => /^[([{]/.test(e.src)),
    );
    const signed = fc
      .tuple(fc.constantFrom('-', '+'), numberLiteral)
      .filter(([, n]) => /^\d/.test(n.src))
      .map(([sign, n]) => ({
        src: sign + n.src,
        value: sign === '-' ? -(n.value as number) : n.value,
        primary: false,
      }));
    const negated = head.map((e) => ({
      src: `!${e.src}`,
      value: !e.value,
      primary: false,
    }));
    const compact = fc
      .tuple(
        head.filter((e) => !e.objectStart),
        fc.constantFrom(...Object.keys(BINARY_OPS)),
        // Primaries never have whitespace outside literals and brackets.
        primary(depth),
      )
      .chain(([l, op, r]) => {
        const v = tryValue(() => BINARY_OPS[op]!(l.value, r.value));
        // A space would make the operator its own (non-standalone) token.
        if (!v || needsSpace(l.src + op, r.src)) return fc.constant(l);
        return fc.constant<Expr>({
          src: l.src + op + r.src,
          value: v.value,
          primary: false,
        });
      });
    return fc.oneof(head, signed, negated, compact);
  }

  return {
    any: any(maxDepth),
    primary: primary(maxDepth),
    standalone: standalone(Math.max(0, maxDepth - 1)),
    string,
    template: template(maxDepth),
  };
}

export interface LabelOptions {
  /** Include line breaks (default true). */
  newlines?: boolean;
  /** Include `{` and `}`, including `{$x}` interpolation (default true). */
  braces?: boolean;
}

/**
 * Label text as an author might want it shown: quotes of every kind,
 * backslash runs, escape-like sequences (`\n`, `\d`), line breaks, braces,
 * commas and words that are keywords elsewhere in the argument grammar.
 */
export function labelText(opts: LabelOptions = {}): fc.Arbitrary<string> {
  const pieces = [
    'a',
    'Z',
    ' ',
    '  ',
    '"',
    "'",
    '`',
    '\\',
    '\\\\',
    '\\n',
    '\\d',
    '\\"',
    "\\'",
    ',',
    '(',
    ')',
    '[',
    ']',
    '/',
    '$x',
    '_t',
    '@n',
    '%',
    'é',
    '😀',
    '\t',
    ' noclose',
    ' once',
    ' inline',
    'goto',
  ];
  if (opts.newlines !== false) pieces.push('\n', '\r\n');
  if (opts.braces !== false) pieces.push('{', '}', '{$x}');
  const unit = fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(...pieces) },
    {
      weight: 1,
      arbitrary: fc
        .string({ maxLength: 3 })
        .map((s) => (opts.braces === false ? s.replace(/[{}]/g, '') : s)),
    },
  );
  return fc.array(unit, { maxLength: 8 }).map((parts) => parts.join(''));
}

/**
 * Quote `text` the way an author would for a literal macro argument (#200):
 * `\` and the quote character are escaped. With `minimal`, a backslash is
 * escaped only where it would otherwise escape a quote, another backslash
 * or the closing quote, since other backslash sequences are kept as
 * written.
 */
export function quoteForAuthor(
  text: string,
  quote: '"' | "'",
  minimal = false,
): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === quote) {
      out += `\\${quote}`;
    } else if (c === '\\') {
      const next = text[i + 1];
      const needed =
        next === undefined || next === '"' || next === "'" || next === '\\';
      out += !minimal || needed ? '\\\\' : '\\';
    } else {
      out += c;
    }
  }
  return quote + out + quote;
}

/** A label paired with an author's quoted form of it. */
export function quotedLabel(
  opts: LabelOptions = {},
): fc.Arbitrary<{ text: string; quoted: string }> {
  return fc
    .tuple(labelText(opts), fc.constantFrom<'"' | "'">('"', "'"), fc.boolean())
    .map(([text, q, minimal]) => ({
      text,
      quoted: quoteForAuthor(text, q, minimal),
    }));
}
