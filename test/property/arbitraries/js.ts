/**
 * Grammar-based generators of JavaScript source for the expression engine's
 * property tests.
 *
 * A generated program is a `Doc`: a list of pieces that are either code
 * text, literal text (string, template and regex literal text, comments) or
 * sigil variable references. Rendering a doc in different modes gives
 *
 * - `sigil`: the source an author writes (`$a`, `_b`, `@c`, `%d`),
 * - `transformed`: what `transform` must turn it into
 *   (`variables["a"]`, …), literal text untouched,
 * - `native`: the same program with each reference replaced by a plain
 *   identifier (`V$a`, `T$b`, `L$c`, `R$d`), which the tests bind to the
 *   namespace values and run as ordinary JavaScript.
 *
 * The generators know where every literal begins and ends, so they are an
 * independent oracle for the lexer. Tokens are glued with random whitespace
 * and comments, including none at all, but never so that adjacent tokens
 * merge into different ones (`a + +b` must not become `a++b`).
 */
import { fc } from '@fast-check/vitest';
import { parse } from 'acorn';

export type Sigil = '$' | '_' | '@' | '%';
/** A sigil variable reference. */
export interface Ref {
  readonly ref: Sigil;
  readonly name: string;
}
/** Literal text, which the transform must pass through untouched. */
export interface Lit {
  readonly lit: string;
  readonly regex?: boolean;
}
export type Piece = string | Ref | Lit;
export type Doc = readonly Piece[];
export type Mode = 'sigil' | 'transformed' | 'native';

export const NAMESPACE = {
  $: 'variables',
  _: 'temporary',
  '@': 'locals',
  '%': 'transient',
} as const;

const NATIVE_PREFIX = { $: 'V$', _: 'T$', '@': 'L$', '%': 'R$' } as const;

export const nativeName = (r: Ref): string => NATIVE_PREFIX[r.ref] + r.name;

const isRef = (p: Piece): p is Ref => typeof p === 'object' && 'ref' in p;
const isLit = (p: unknown): p is Lit =>
  typeof p === 'object' && p !== null && 'lit' in p;

/** Ends with an identifier character (so a following word would merge). */
const ENDS_WITH_ID = /[\p{ID_Continue}$\u200c\u200d]$/u;
const ID_CHAR = /^[\p{ID_Continue}$\u200c\u200d\\]/u;

function pieceText(p: Piece, mode: Mode): string {
  if (typeof p === 'string') return p;
  if (isLit(p)) return p.lit;
  if (mode === 'sigil') return p.ref + p.name;
  if (mode === 'native') return nativeName(p);
  return `${NAMESPACE[p.ref]}["${p.name}"]`;
}

export function render(doc: Doc, mode: Mode): string {
  let out = '';
  for (const p of doc) {
    // `typeof%x` / `in@y` reference a variable right after a keyword; the
    // replacement starts with a letter and needs a space to stay apart.
    if (isRef(p) && mode !== 'sigil' && ENDS_WITH_ID.test(out)) out += ' ';
    out += pieceText(p, mode);
  }
  return out;
}

/** Every reference in a doc. */
export const refsOf = (doc: Doc): Ref[] => doc.filter(isRef);

// ---------------------------------------------------------------------------
// Gluing tokens
// ---------------------------------------------------------------------------

interface Edge {
  ch: string;
  regex: boolean;
}

function lastEdge(doc: Doc): Edge | undefined {
  for (let i = doc.length - 1; i >= 0; i--) {
    const p = doc[i]!;
    const text = pieceText(p, 'sigil');
    if (text)
      return { ch: text.slice(-1), regex: isLit(p) && p.regex === true };
  }
  return undefined;
}

function firstChar(doc: Doc): string {
  for (const p of doc) {
    const text = pieceText(p, 'sigil');
    if (text) return text.charAt(0);
  }
  return '';
}

/** Would `l` directly followed by `r` lex as something else? */
function merges(l: Edge, r: string): boolean {
  if (!r) return false;
  const rWord = ID_CHAR.test(r);
  if (rWord && (ENDS_WITH_ID.test(l.ch) || l.regex)) return true; // `typeof x`, `/a/ in`
  if ((l.ch === '+' || l.ch === '-') && r === l.ch) return true; // `+ +`
  if (l.ch === '/' && (r === '/' || r === '*')) return true; // comments
  if (l.ch === '<' && r === '!') return true; // `<!--` (Annex B comment)
  if (l.ch === '-' && r === '>') return true; // `-->` (Annex B comment)
  if (l.ch === '.' && (r === '.' || /\d/.test(r))) return true;
  if (/\d/.test(l.ch) && r === '.') return true; // `1 .x`
  return false;
}

export function glue(a: Doc, b: Doc): Doc {
  const l = lastEdge(a);
  if (l && merges(l, firstChar(b))) return [...a, ' ', ...b];
  return [...a, ...b];
}

const concat = (docs: readonly Doc[]): Doc => docs.reduce(glue, []);

// ---------------------------------------------------------------------------
// Literal text
// ---------------------------------------------------------------------------

/** Characters that tend to confuse a hand-written JS lexer. */
const TRICKY = [
  '$',
  '_',
  '@',
  '%',
  '$x',
  '_y',
  '@z',
  '%w',
  '"',
  "'",
  '`',
  '${',
  '{',
  '}',
  '/',
  '*',
  '//',
  '/*',
  '*/',
  '\\',
  ' ',
  'a',
  'é',
  '(',
  ')',
  '[',
  ']',
  ';',
  '\n',
  '\r',
  '\u2028',
  '\u2029',
  '\t',
  '+',
  '-',
  '=',
  '#',
  'ℵ',
  '😀',
];

const rawUnit = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...TRICKY) },
  {
    weight: 1,
    arbitrary: fc.string({ unit: 'binary', minLength: 1, maxLength: 1 }),
  },
);
const rawText = (maxLength: number) =>
  fc.array(rawUnit, { maxLength }).map((units) => units.join(''));

const LINE_TERMINATOR = /[\n\r\u2028\u2029]/g;

const lineComment = fc
  .tuple(rawText(6), fc.constantFrom('\n', '\r', '\r\n', '\u2028', '\u2029'))
  .map(([text, end]): Doc => [
    { lit: '//' + text.replace(LINE_TERMINATOR, ' ') },
    end,
  ]);

const blockComment = (inline: boolean) =>
  rawText(6).map((text): Doc => {
    let body = text.replace(/\*\//g, '* /');
    if (inline) body = body.replace(LINE_TERMINATOR, ' ');
    return [{ lit: '/*' + body + '*/' }];
  });

/** Whitespace and comments between two tokens (possibly nothing). */
export const trivia: fc.Arbitrary<Doc> = fc.oneof(
  { weight: 6, arbitrary: fc.constant([' ']) },
  { weight: 5, arbitrary: fc.constant([]) },
  { weight: 2, arbitrary: fc.constantFrom(['\n'], ['\t'], ['  '], ['\r\n']) },
  { weight: 1, arbitrary: blockComment(false) },
  { weight: 1, arbitrary: lineComment },
);

/** Trivia that contains no line terminator. */
export const inlineTrivia: fc.Arbitrary<Doc> = fc.oneof(
  { weight: 6, arbitrary: fc.constant([' ']) },
  { weight: 5, arbitrary: fc.constant([]) },
  { weight: 1, arbitrary: blockComment(true) },
);

const STRING_ESCAPES = [
  '\\\\',
  "\\'",
  '\\"',
  '\\n',
  '\\x41',
  '\\u0041',
  '\\u{1F600}',
  '\\$',
  '\\`',
  '\\{',
  '\\\n',
  '\\/',
];

/** A `'…'` or `"…"` string literal. */
const stringLiteral = fc
  .tuple(
    fc.constantFrom('"', "'"),
    fc.array(
      fc.oneof(
        { weight: 4, arbitrary: rawUnit.map((u) => ({ raw: u })) },
        { weight: 1, arbitrary: fc.constantFrom(...STRING_ESCAPES) },
      ),
      { maxLength: 6 },
    ),
  )
  .map(([q, units]) => {
    const body = units
      .map((u) =>
        typeof u === 'string'
          ? u
          : u.raw
              .replace(/\\/g, '\\\\')
              .replace(q === '"' ? /"/g : /'/g, '\\' + q)
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r'),
      )
      .join('');
    return q + body + q;
  });

const TEMPLATE_ESCAPES = [
  '\\\\',
  '\\`',
  '\\${',
  '\\$',
  '\\{',
  '\\n',
  '\\x41',
  '\\u{1F600}',
  '\\\n',
];

/** Text between a template literal's backticks and interpolations. */
const templateText = fc
  .array(
    fc.oneof(
      {
        weight: 4,
        arbitrary: rawUnit.map((u) =>
          u.replace(/\\/g, '\\\\').replace(/`/g, '\\`'),
        ),
      },
      { weight: 1, arbitrary: fc.constantFrom(...TEMPLATE_ESCAPES) },
    ),
    { minLength: 1, maxLength: 5 },
  )
  .map((units) =>
    units
      .join('')
      // An unescaped `${` would open an interpolation, and a trailing `$`
      // could form one with whatever follows.
      .replace(/(?<!\\)((?:\\\\)*)\$(?=\{|$)/g, '$1\\$'),
  );

const regexAtom = fc.oneof(
  fc.constantFrom(
    'a',
    'b',
    '$',
    '_',
    '@',
    '%',
    '"',
    "'",
    '`',
    '}',
    '#',
    ' ',
    '-',
    '=',
    '!',
    ',',
    ';',
    ':',
    '<',
    '>',
    '.',
    '\\/',
    '\\\\',
    '\\d',
    '\\$',
    '\\.',
    '\\*',
    '\\[',
    '\\{',
    '$x',
    '_y',
    '@z',
    '%w',
  ),
  fc
    .array(
      fc.constantFrom(
        '/',
        '"',
        "'",
        '`',
        '$',
        '_',
        '@',
        '%',
        '*',
        '[',
        '\\]',
        'a-z',
        '\\/',
        '{',
        '}',
        '(',
      ),
      { maxLength: 4 },
    )
    .map((cs) => '[' + cs.join('') + ']'),
);

/** A regex literal `/…/flags` whose pattern is valid with every flag set. */
const regexLiteral = fc
  .tuple(
    fc.array(
      fc.tuple(regexAtom, fc.constantFrom('', '', '', '*', '+', '?', '{2}')),
      { minLength: 1, maxLength: 5 },
    ),
    fc.subarray(['d', 'g', 'i', 'm', 's', 'y']),
  )
  .map(
    ([atoms, flags]) =>
      '/' + atoms.map(([a, q]) => a + q).join('') + '/' + flags.join(''),
  )
  .filter((src) => {
    try {
      new Function('return ' + src);
      return true;
    } catch {
      return false;
    }
  });

// ---------------------------------------------------------------------------
// Grammar
// ---------------------------------------------------------------------------

/** Plain identifiers the programs bind (see `bindIdents`). */
export const IDENTS = [
  'p',
  'q',
  'é',
  'a$b',
  'ñ_x',
  'x_1',
  'ℵ',
  'of',
  'get',
  'async',
];
const IDENT_VALUES = [
  '1',
  '"two"',
  '[3, "$x"]',
  '{ k: 4, "_x": 5 }',
  '-5',
  '"_y"',
  'null',
  '2',
  '"g"',
  '3',
];

/**
 * Names of sigil variables. `$`, `_` and `@` take `\w+`, `%` an identifier.
 * Names of Object.prototype members are plain variables (the namespaces
 * have no prototype).
 */
export const NAMES = [
  'a',
  'b',
  'x1',
  '_p',
  'in',
  'typeof',
  'return',
  'of',
  'constructor',
  'toString',
  'hasOwnProperty',
  'valueOf',
  '__defineGetter__',
];
const NUMERIC_NAMES = ['1', '2b'];
/** The one name no namespace holds: programs using it are refused. */
export const RESERVED_NAME = '__proto__';

const GLOBALS = [
  'Math',
  'String',
  'Number',
  'JSON',
  'undefined',
  'NaN',
  'Infinity',
  'true',
  'false',
  'null',
];
const NUMBERS = [
  '0',
  '1',
  '2',
  '7',
  '3.5',
  '.5',
  '0x1F',
  '1e3',
  '1_000',
  '0.25',
];
const PROPS = [
  'x',
  'k',
  'length',
  '_x',
  '$x',
  '_',
  'return',
  'in',
  'typeof',
  'of',
  'é',
  'toString',
  'map',
  'slice',
  'max',
  'raw',
];
const KEYS = [
  'x',
  'k',
  '_id',
  '$k',
  '_',
  '$',
  '__',
  'in',
  'return',
  'typeof',
  'of',
  'get',
  'set',
  'static',
  'async',
  'function',
  'class',
  '"s"',
  "'$q'",
  '1',
  '0x2',
  'é',
];
const BINARY = [
  '+',
  '-',
  '*',
  '/',
  '%',
  '**',
  '==',
  '===',
  '!=',
  '!==',
  '<',
  '>',
  '<=',
  '>=',
  '&&',
  '||',
  '??',
  '&',
  '|',
  '^',
  '<<',
  '>>',
  '>>>',
  'in',
  'instanceof',
];
const ASSIGN = [
  '=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '**=',
  '||=',
  '&&=',
  '??=',
  '<<=',
  '|=',
];
const UNARY = ['!', '-', '+', '~', 'typeof', 'void'];

/** A statement, and how it may be followed. */
export interface Stmt {
  readonly doc: Doc;
  /** Ends with an expression and needs `;` (or a line break, by ASI). */
  readonly semi: boolean;
  /**
   * May start a new line after a statement whose `;` was left out. False
   * when the line would continue the previous statement (`(`, `[`, `/`,
   * `+`, …) or when it is a genuine ambiguity of the sigil dialect: a line
   * `%a…` after `$x = 5` reads as modulo `5 % a…` wherever that is valid
   * JavaScript, so only a `%a… = …` assignment (where it is not) can start
   * such a line as a transient reference.
   */
  readonly asiSafe: boolean;
}

const NOBR = Symbol('no line break here');
type Part = string | Lit | Doc | fc.Arbitrary<Doc> | typeof NOBR;

/** Tokens in order, with random trivia between them. */
function seq(...parts: Part[]): fc.Arbitrary<Doc> {
  const arbs: fc.Arbitrary<Doc>[] = [];
  let inline = false;
  for (const p of parts) {
    if (p === NOBR) {
      inline = true;
      continue;
    }
    if (arbs.length > 0) arbs.push(inline ? inlineTrivia : trivia);
    inline = false;
    if (typeof p === 'string' || isLit(p)) arbs.push(fc.constant([p]));
    else if (Array.isArray(p)) arbs.push(fc.constant(p as Doc));
    else arbs.push(p as fc.Arbitrary<Doc>);
  }
  return fc.tuple(...arbs).map(concat);
}

/** Items separated by `sep` (with trivia), possibly none. */
function list(
  item: fc.Arbitrary<Doc>,
  sep: string,
  maxLength: number,
): fc.Arbitrary<Doc> {
  return fc
    .array(fc.tuple(item, trivia, trivia), { maxLength })
    .map((items) =>
      concat(
        items.map(([d, t1, t2], i) =>
          i === 0 ? d : concat([t1, [sep], t2, d]),
        ),
      ),
    );
}

const tok = (...xs: string[]) => fc.constantFrom(...xs).map((x): Doc => [x]);

export interface JsOptions {
  /** Generate sigil variable references. */
  refs: boolean;
}

export function jsArbitraries({ refs }: JsOptions) {
  const reserved = { weight: 1, arbitrary: fc.constant(RESERVED_NAME) };
  const transientName = fc.oneof(
    { weight: 20, arbitrary: fc.constantFrom(...NAMES) },
    reserved,
  );
  const wordName = fc.oneof(
    { weight: 20, arbitrary: fc.constantFrom(...NAMES, ...NUMERIC_NAMES) },
    reserved,
  );
  const ref: fc.Arbitrary<Ref> = fc.oneof(
    fc.record({ ref: fc.constantFrom<Sigil>('$', '_', '@'), name: wordName }),
    fc.record({ ref: fc.constant<Sigil>('%'), name: transientName }),
  );
  const refDoc = ref.map((r): Doc => [r]);
  const ident = tok(...IDENTS);

  const string = stringLiteral.map((s): Doc => [{ lit: s }]);
  const regex = regexLiteral.map((s): Doc => [{ lit: s, regex: true }]);
  const number = tok(...NUMBERS);

  const arbs = fc.letrec<{
    expr: Doc;
    operand: Doc;
    target: Doc;
    template: Doc;
    stmt: Stmt;
    block: Doc;
  }>((tie) => {
    const expr = tie('expr');
    const operand = tie('operand');
    const target = tie('target');
    const template = tie('template');
    const block = tie('block');

    const params = fc.oneof(ident, seq('(', list(ident, ',', 3), ')'));
    /** An expression usable as an arrow body: an object literal needs (). */
    const arrowBody = fc.oneof(
      expr.map((d): Doc =>
        firstChar(d) === '{' ? concat([['('], d, [')']]) : d,
      ),
      block,
    );

    const key = fc.oneof(
      { weight: 4, arbitrary: tok(...KEYS) },
      { weight: 1, arbitrary: seq('[', expr, ']') },
    );
    /** A method: plain, getter, setter or generator. */
    const method = fc.oneof(
      seq(key, '(', list(ident, ',', 2), ')', block),
      seq('get', key, '(', ')', block),
      seq('set', key, '(', ident, ')', block),
      seq('*', key, '(', ')', block),
      seq('async', NOBR, key, '(', ')', block),
    );
    const objectProp = fc.oneof(
      seq(key, ':', expr),
      ident,
      seq('...', operand),
      method,
    );
    /**
     * A class member. A field ends with `;` or, by ASI, a line break —
     * unless the next member starts with `[`, `*` or `(` and would continue
     * its initializer.
     */
    const classMember = fc.oneof(
      { weight: 3, arbitrary: method },
      { weight: 1, arbitrary: seq('static', method) },
      { weight: 1, arbitrary: seq('static', block) },
      {
        weight: 3,
        arbitrary: fc
          .tuple(
            fc.oneof(
              seq(fc.constantFrom([], ['static']), tok(...KEYS)),
              tok('#p', '#_q', '#$r'),
            ),
            fc.option(seq('=', expr), { nil: [] as Doc }),
            fc.boolean(),
          )
          .map(([name, init, asi]) => ({ field: concat([name, init]), asi })),
      },
    );
    const classBody = fc
      .array(fc.tuple(classMember, trivia), { maxLength: 3 })
      .map((members) => {
        const docs: Doc[] = [['{']];
        members.forEach(([m, t], i) => {
          if ('field' in m) {
            const next = members[i + 1]?.[0];
            const nextText = next
              ? render('field' in next ? next.field : next, 'sigil')
              : '';
            docs.push(
              m.field,
              m.asi && /^[\p{ID_Start}$_#\\]/u.test(nextText) ? ['\n'] : [';'],
            );
          } else {
            docs.push(m);
          }
          docs.push(t);
        });
        docs.push(['}']);
        return concat(docs);
      });
    const classDef = fc.oneof(
      seq('class', classBody),
      seq('class', 'C', classBody),
      seq('class', 'C', 'extends', 'Object', classBody),
    );

    const primary = fc.oneof(
      { weight: 3, arbitrary: number },
      { weight: 3, arbitrary: string },
      { weight: 2, arbitrary: regex },
      { weight: 3, arbitrary: ident },
      { weight: 1, arbitrary: tok(...GLOBALS) },
      { weight: refs ? 6 : 0, arbitrary: refDoc },
      { weight: 2, arbitrary: template },
    );

    return {
      template: fc
        .array(
          fc.oneof(
            templateText.map((t): Doc => [{ lit: t }]),
            fc
              .tuple(trivia, expr, trivia)
              .map(([a, e, b]): Doc => [
                { lit: '${' },
                ...concat([a, e, b]),
                { lit: '}' },
              ]),
          ),
          { maxLength: 3 },
        )
        .map((parts): Doc => [{ lit: '`' }, ...parts.flat(), { lit: '`' }]),

      target: fc.oneof(
        { weight: refs ? 4 : 0, arbitrary: refDoc },
        { weight: 1, arbitrary: ident },
        {
          weight: 2,
          arbitrary: seq(refs ? refDoc : ident, '.', tok(...PROPS)),
        },
        { weight: 1, arbitrary: seq(refs ? refDoc : ident, '[', expr, ']') },
      ),

      operand: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        { weight: 8, arbitrary: primary },
        { weight: 2, arbitrary: seq('(', expr, ')') },
        { weight: 1, arbitrary: seq('(', expr, ',', expr, ')') },
        {
          weight: 1,
          arbitrary: seq(
            '[',
            list(fc.oneof(expr, seq('...', operand)), ',', 3),
            ']',
          ),
        },
        { weight: 1, arbitrary: seq('{', list(objectProp, ',', 3), '}') },
        {
          weight: 2,
          arbitrary: seq(
            operand,
            fc.constantFrom(['.'], ['?.']),
            tok(...PROPS),
          ),
        },
        {
          weight: 1,
          arbitrary: seq(operand, fc.constantFrom(['['], ['?.[']), expr, ']'),
        },
        { weight: 1, arbitrary: seq(operand, '(', list(expr, ',', 2), ')') },
        { weight: 1, arbitrary: seq('String', '.', 'raw', template) },
        {
          weight: 1,
          arbitrary: seq('Math', '.', 'max', '(', list(expr, ',', 3), ')'),
        },
        {
          weight: 1,
          arbitrary: seq(
            '[',
            list(expr, ',', 2),
            ']',
            '.',
            'map',
            '(',
            params,
            NOBR,
            '=>',
            arrowBody,
            ')',
          ),
        },
        { weight: 1, arbitrary: seq(target, NOBR, tok('++', '--')) },
        { weight: 1, arbitrary: seq(tok('++', '--'), target) },
        {
          weight: 1,
          arbitrary: seq('function', '(', list(ident, ',', 2), ')', block),
        },
        { weight: 1, arbitrary: classDef },
      ),

      expr: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        { weight: 6, arbitrary: operand },
        { weight: 4, arbitrary: seq(operand, tok(...BINARY), operand) },
        { weight: 2, arbitrary: seq(tok(...UNARY), operand) },
        { weight: 1, arbitrary: seq(operand, '?', expr, ':', expr) },
        { weight: 2, arbitrary: seq(target, tok(...ASSIGN), expr) },
        { weight: 1, arbitrary: seq(params, NOBR, '=>', arrowBody) },
        { weight: 1, arbitrary: seq('new', 'Number', '(', expr, ')') },
      ),

      block: seq('{', stmtList(tie('stmt')), '}'),

      stmt: fc.oneof(
        { depthSize: 'small', withCrossShrink: true },
        { weight: 6, arbitrary: exprStmt(sequence(expr)) },
        { weight: refs ? 3 : 1, arbitrary: assignStmt(target, expr) },
        { weight: 1, arbitrary: compound(block) },
        {
          weight: 1,
          arbitrary: compound(seq('if', '(', expr, ')', bodyOf(tie('stmt')))),
        },
        {
          weight: 1,
          arbitrary: compound(
            seq(
              'if',
              '(',
              expr,
              ')',
              bodyOf(tie('stmt')),
              'else',
              bodyOf(tie('stmt')),
            ),
          ),
        },
        {
          weight: 1,
          arbitrary: compound(
            seq(
              'for',
              '(',
              'let',
              'i',
              '=',
              '0',
              ';',
              'i',
              '<',
              '2',
              ';',
              'i',
              NOBR,
              '++',
              ')',
              bodyOf(tie('stmt')),
            ),
          ),
        },
        {
          weight: 1,
          arbitrary: compound(
            seq(
              'for',
              '(',
              fc.oneof(seq('const', ident), target),
              tok('of', 'in'),
              expr,
              ')',
              bodyOf(tie('stmt')),
            ),
          ),
        },
        {
          weight: 1,
          arbitrary: compound(
            seq(
              'switch',
              '(',
              expr,
              ')',
              '{',
              'case',
              expr,
              ':',
              stmtList(tie('stmt')),
              'default',
              ':',
              stmtList(tie('stmt')),
              '}',
            ),
          ),
        },
        {
          weight: 1,
          arbitrary: compound(
            seq('function', 'f', '(', list(ident, ',', 2), ')', block),
          ),
        },
        { weight: 1, arbitrary: compound(seq('class', 'D', classBody)) },
        {
          weight: 1,
          arbitrary: compound(seq('lbl', ':', bodyOf(tie('stmt')))),
        },
        {
          weight: 1,
          arbitrary: fc
            .oneof(seq('return', NOBR, sequence(expr)), fc.constant(['return']))
            .map((doc): Stmt => ({ doc, semi: true, asiSafe: true })),
        },
        {
          weight: 1,
          arbitrary: compound(
            seq(
              'try',
              block,
              'catch',
              '(',
              ident,
              ')',
              block,
              'finally',
              block,
            ),
          ),
        },
        {
          weight: 1,
          arbitrary: seq(
            'do',
            bodyOf(tie('stmt')),
            'while',
            '(',
            'false',
            ')',
          ).map((doc): Stmt => ({ doc, semi: true, asiSafe: true })),
        },
        {
          weight: 1,
          arbitrary: seq('var', ident, '=', expr).map((doc): Stmt => ({
            doc,
            semi: true,
            asiSafe: true,
          })),
        },
      ),
    };
  });

  return {
    ...arbs,
    /** An expression, possibly a comma-separated sequence. */
    sequence: sequence(arbs.expr),
    /** A statement list. */
    program: stmtList(arbs.stmt),
  };
}

/**
 * An expression or a comma sequence of two. The comma operator only appears
 * here and in parentheses: in an argument list, array or object literal the
 * comma would separate items instead.
 */
const sequence = (expr: fc.Arbitrary<Doc>) =>
  fc.oneof(
    { weight: 4, arbitrary: expr },
    { weight: 1, arbitrary: seq(expr, ',', expr) },
  );

const compound = (a: fc.Arbitrary<Doc>) =>
  a.map((doc): Stmt => ({ doc, semi: false, asiSafe: true }));

/** May this expression statement start a line after a missing `;`? */
function startsSafely(doc: Doc): boolean {
  const first = doc.find((p) => pieceText(p, 'sigil') !== '');
  if (first === undefined) return false;
  if (isRef(first)) return first.ref !== '%';
  const text = pieceText(first, 'sigil');
  if (text === '++' || text === '--') return true; // prefix after ASI
  return /^[\p{ID_Start}$_\\"'!~]/u.test(text) && !text.startsWith('.');
}

/**
 * An expression statement. One that starts like an object literal or a
 * function expression would be read as a block or declaration: wrap it.
 */
function exprStmt(expr: fc.Arbitrary<Doc>): fc.Arbitrary<Stmt> {
  return expr.map((d): Stmt => {
    const text = render(d, 'sigil');
    const doc =
      text.startsWith('{') || /^(function|class|let)\b/.test(text)
        ? concat([['('], d, [')']])
        : d;
    return { doc, semi: true, asiSafe: startsSafely(doc) };
  });
}

/** An assignment statement: `%a.b = 1` may start a line (see `Stmt`). */
function assignStmt(
  target: fc.Arbitrary<Doc>,
  expr: fc.Arbitrary<Doc>,
): fc.Arbitrary<Stmt> {
  return seq(target, tok(...ASSIGN), expr).map((doc): Stmt => ({
    doc,
    semi: true,
    asiSafe: startsSafely(doc) || (isRef(doc[0]!) && doc[0].ref === '%'),
  }));
}

/** The body of if/for/do: a statement, terminated if it needs one. */
function bodyOf(stmt: fc.Arbitrary<Stmt>): fc.Arbitrary<Doc> {
  return fc
    .tuple(stmt, inlineTrivia)
    .map(([s, t]) => (s.semi ? concat([s.doc, t, [';']]) : s.doc));
}

/**
 * Statements in sequence. An expression statement ends with `;` or, where
 * ASI allows, with a line break alone.
 */
function stmtList(stmt: fc.Arbitrary<Stmt>): fc.Arbitrary<Doc> {
  return fc
    .array(fc.tuple(stmt, fc.boolean(), inlineTrivia, trivia), { maxLength: 3 })
    .map((items) => {
      const docs: Doc[] = [];
      items.forEach(([s, dropSemi, before, after], i) => {
        docs.push(s.doc);
        const next = items[i + 1]?.[0];
        if (s.semi) {
          if (dropSemi && next === undefined) {
            // last statement: ASI at the end
          } else if (dropSemi && next?.asiSafe) {
            docs.push(before, ['\n']);
          } else {
            docs.push(before, [';']);
          }
        }
        if (next) docs.push(after);
      });
      return concat(docs);
    });
}

/** Wrap an expression so the plain identifiers it uses are bound. */
export function bindIdentsExpr(doc: Doc): Doc {
  return concat([
    ['((' + IDENTS.join(', ') + ') => ('],
    doc,
    ['\n))(' + IDENT_VALUES.join(', ') + ')'],
  ]);
}

/** Prefix a statement list with declarations of the plain identifiers. */
export function bindIdentsStmts(doc: Doc): Doc {
  return concat([
    [
      'var ' +
        IDENTS.map((id, i) => `${id} = ${IDENT_VALUES[i]}`).join(', ') +
        ';\n',
    ],
    doc,
  ]);
}

/**
 * Is `body` a valid function body? V8 compiles some code the specification
 * rejects before it runs, such as `++f()` (V8 throws only when it runs), and
 * Spindle rejects that code too (docs/variables.md "Code in passages").
 */
export function compiles(body: string): boolean {
  try {
    parse(body, { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
    new Function(body);
    return true;
  } catch {
    return false;
  }
}
