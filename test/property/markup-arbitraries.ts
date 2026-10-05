/**
 * Arbitraries for property tests of the markup pipeline (tokenizer, AST
 * builder, renderer). Grammar arbitraries produce passage source together with
 * the AST the parser should build for it, so tests can check the round trip.
 */
import { fc } from '@fast-check/vitest';
import type { ASTNode, Branch, MacroNode } from '../../src/markup/ast';
import { NUM_RUNS } from './config';

export interface Generated {
  src: string;
  ast: ASTNode[];
}

const concat = (parts: Generated[]): Generated => ({
  src: parts.map((p) => p.src).join(''),
  ast: parts.flatMap((p) => p.ast),
});

/** Merge adjacent text nodes and drop empty ones, recursively. */
export function normalizeAST(nodes: ASTNode[]): ASTNode[] {
  const out: ASTNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value === '') continue;
      const last = out[out.length - 1];
      if (last?.type === 'text') {
        out[out.length - 1] = { type: 'text', value: last.value + node.value };
      } else {
        out.push({ type: 'text', value: node.value });
      }
      continue;
    }
    if (node.type === 'macro') {
      const copy: MacroNode = {
        ...node,
        children: normalizeAST(node.children),
      };
      if (node.branches) {
        copy.branches = node.branches.map((b) => ({
          ...b,
          children: normalizeAST(b.children),
        }));
      }
      out.push(copy);
      continue;
    }
    if (node.type === 'html') {
      out.push({ ...node, children: normalizeAST(node.children) });
      continue;
    }
    out.push(node);
  }
  return out;
}

/** Characters that never start or affect spindle markup in plain text. */
const PLAIN_CHARS = [
  ...'abcxyzABZ019 .,;:!?*_#-|~=+$%@/"\'`()&>]é\t',
  '\n',
  '\n\n',
  '  ',
];

const plainText = fc.string({
  unit: fc.constantFrom(...PLAIN_CHARS),
  minLength: 1,
  maxLength: 12,
});

const textNode = (value: string): ASTNode => ({ type: 'text', value });

/** Plain text, or an escaped brace (`\{` / `\}`), which renders the brace. */
const textArb: fc.Arbitrary<Generated> = fc.oneof(
  {
    weight: 4,
    arbitrary: plainText.map((s) => ({ src: s, ast: [textNode(s)] })),
  },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom('{', '}')
      .map((b) => ({ src: `\\${b}`, ast: [textNode(b)] })),
  },
);

const identifier = fc.stringMatching(/^[A-Za-z_][A-Za-z0-9_]{0,5}$/);

const varPath = fc
  .tuple(
    identifier,
    fc.array(fc.oneof(identifier, fc.stringMatching(/^[0-9]{1,2}$/)), {
      maxLength: 2,
    }),
  )
  .map(([root, rest]) => [root, ...rest].join('.'));

const SIGILS = {
  $: 'variable',
  _: 'temporary',
  '@': 'local',
  '%': 'transient',
} as const;
type Sigil = keyof typeof SIGILS;
const sigil = fc.constantFrom<Sigil>('$', '_', '@', '%');

const selectorName = fc.oneof(
  { weight: 5, arbitrary: fc.stringMatching(/^[a-zA-Z0-9_-]{1,6}$/) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.stringMatching(/^[a-z]{1,3}-$/), sigil, identifier)
      .map(([p, s, n]) => `${p}{${s}${n}}`),
  },
);

/** `.a.b#c` selector prefix with the className / id it should produce. */
const selectors = fc
  .array(fc.tuple(fc.constantFrom('.', '#'), selectorName), {
    minLength: 1,
    maxLength: 3,
  })
  .map((segs) => {
    const classes = segs.filter(([p]) => p === '.').map(([, n]) => n);
    const ids = segs.filter(([p]) => p === '#').map(([, n]) => n);
    const out: { src: string; className?: string; id?: string } = {
      src: segs.map(([p, n]) => p + n).join(''),
    };
    if (classes.length) out.className = classes.join(' ');
    if (ids.length) out.id = ids[ids.length - 1];
    return out;
  });

const optSelectors = fc.option(selectors, { nil: undefined });

function withSelectors<T extends object>(
  node: T,
  sel: { className?: string; id?: string } | undefined,
): T {
  const out: Record<string, unknown> = { ...node };
  if (sel?.className) out.className = sel.className;
  if (sel?.id) out.id = sel.id;
  return out as T;
}

const variableArb: fc.Arbitrary<Generated> = fc
  .tuple(sigil, varPath, optSelectors, fc.boolean())
  .map(([s, name, sel, space]) => ({
    // Without a space, `_` would continue the selector name (`{.a_x}`).
    src: sel
      ? `{${sel.src}${space || s === '_' ? ' ' : ''}${s}${name}}`
      : `{${s}${name}}`,
    ast: [
      withSelectors(
        { type: 'variable', name, scope: SIGILS[s] } as ASTNode,
        sel,
      ),
    ],
  }));

/** JS string / template literals, including braces that must not count. */
const jsStringLiteral = fc.oneof(
  fc
    .string({ unit: fc.constantFrom(..."ab {}'<>[]`"), maxLength: 6 })
    .map((s) => `"${s}"`),
  fc
    .string({ unit: fc.constantFrom(...'ab {}"<>[]`'), maxLength: 6 })
    .map((s) => `'${s}'`),
  fc
    .string({ unit: fc.constantFrom(...'ab {}"\'<>'), maxLength: 6 })
    .map((s) => `\`${s}\``),
  fc.constant('`a${1 + {b: 2}.b}c`'),
  fc.constant('"q\\"}"'),
);

const jsOperand = fc.oneof(
  fc.integer({ min: 0, max: 99 }).map(String),
  jsStringLiteral,
  fc.constant('{a: {b: "}"}}'),
  fc.constant('[1, 2]'),
);

/** Regex literals holding braces, quotes, backticks and slashes. */
const jsRegex = fc.constantFrom(
  '/}/',
  '/\\}/g',
  '/{/',
  '/[{}"\'`]/g',
  '/[/]}/',
  "/'/",
  '/"/',
  '/`/',
);

/** Block comments holding braces, quotes and backticks. */
const jsComment = fc.constantFrom('/* } */', '/* { " \' ` */', '/**/');

/** Operands the passage tokenizer must lex as JavaScript. */
const jsCodeOperand = fc.oneof(
  jsOperand,
  jsRegex,
  jsComment.map((c) => `${c} 1`),
);

const expressionArb: fc.Arbitrary<Generated> = fc
  .tuple(
    sigil,
    varPath,
    fc.constantFrom('+', '===', '||', '?? ', '/'),
    jsCodeOperand,
  )
  .chain(([s, name, op, operand]) =>
    fc.tuple(fc.constant(`${s}${name} ${op} ${operand}`), optSelectors),
  )
  .map(([expression, sel]) => ({
    src: sel ? `{${sel.src} ${expression}}` : `{${expression}}`,
    ast: [withSelectors({ type: 'expression', expression } as ASTNode, sel)],
  }));

const BLOCK = [
  'if',
  'for',
  'do',
  'button',
  'link',
  'listbox',
  'cycle',
  'switch',
  'timed',
  'repeat',
  'type',
  'widget',
  'span',
  'nobr',
];
const BRANCHES = ['elseif', 'else', 'case', 'default', 'next'];

/** Randomly change the case of a macro name (names are case-insensitive). */
const casedName = (name: string) =>
  fc
    .array(fc.boolean(), { minLength: name.length, maxLength: name.length })
    .map((ups) =>
      [...name].map((c, i) => (ups[i] ? c.toUpperCase() : c)).join(''),
    );

const argWord = fc.stringMatching(/^[a-z0-9$_=+<>.]{1,5}$/);

/**
 * Macro arguments: words, JS literals, objects. Trimmed and brace-balanced.
 * Arguments that are JavaScript may hold regex literals (in parentheses, so
 * no `/` after a word reads as division) and comments, whose braces don't
 * count. Prose-like arguments with an apostrophe (`don't`) are no
 * JavaScript and are read leniently, where only string and template
 * literals hide braces.
 */
const macroArgs = fc
  .oneof(
    fc.array(
      fc.oneof(
        argWord,
        jsStringLiteral,
        jsOperand,
        jsRegex.map((r) => `(${r})`),
        jsComment,
        // A line comment, and another word on the next line
        fc.constantFrom('// } " \' `\nx', '//}\n0'),
      ),
      { minLength: 1, maxLength: 4 },
    ),
    fc.array(
      fc.oneof(argWord, jsStringLiteral, jsOperand, fc.constant("don't")),
      { minLength: 1, maxLength: 4 },
    ),
  )
  .chain((words) =>
    fc
      .array(fc.constantFrom(' ', '  ', ', '), {
        minLength: words.length - 1,
        maxLength: words.length - 1,
      })
      .map((seps) =>
        words.map((w, i) => (i === 0 ? w : seps[i - 1] + w)).join(''),
      ),
  );

const argSep = fc.constantFrom(' ', '\t', '\n', '   ');

/** `{name args}` opener (or `{.sel name args}`) with name/rawArgs. */
function opener(name: string, withArgs: boolean) {
  return fc
    .tuple(
      casedName(name),
      withArgs ? fc.option(macroArgs, { nil: '' }) : fc.constant(''),
      argSep,
      optSelectors,
    )
    .map(([cased, args, sep, sel]) => ({
      src: `{${sel ? sel.src + ' ' : ''}${cased}${args ? sep + args : ''}}`,
      rawArgs: args,
      sel,
    }));
}

const closer = (name: string) =>
  fc
    .tuple(casedName(name), fc.constantFrom('', ' ', '\n'))
    .map(([cased, ws]) => `{/${cased}${ws}}`);

const selfClosingMacroArb: fc.Arbitrary<Generated> = fc
  .stringMatching(/^[a-z][a-zA-Z0-9]{0,6}$/)
  .filter((n) => {
    const lower = n.toLowerCase();
    return !BLOCK.includes(lower) && !BRANCHES.includes(lower);
  })
  .chain((name) => opener(name, true).map((o) => ({ name, ...o })))
  .map(({ name, src, rawArgs, sel }) => ({
    src,
    ast: [
      withSelectors(
        {
          type: 'macro',
          name: name.toLowerCase(),
          rawArgs,
          children: [],
        } as ASTNode,
        sel,
      ),
    ],
  }));

/**
 * Code in a `{do}` body: brackets, markup-like text and sigils, but nothing
 * that starts a literal or comment (no quote, backtick or `/`) and no `{/do}`.
 */
export const DO_CODE = [...'{}[]()<>=;$_@% ab\n', '<b>', '[[', '{x}', '%a'];

/** Text a literal or comment may hold: closers, braces, quotes, markup. */
const literalText = (units: string[]) =>
  fc
    .array(fc.constantFrom('a', ' ', '{/do}', '{/DO }', '{', '}', ...units), {
      maxLength: 5,
    })
    .map((parts) => parts.join(''));

/**
 * A literal or comment holding a `{/do}` that must not end the body. Each
 * follows `=`, so a `/` starts a regex and no quote follows a word.
 */
const doLiteral = fc
  .oneof(
    literalText(["'", '`', '\\"', '\\\\', '\n', '<b>', '[[']).map(
      (t) => `"${t}"`,
    ),
    literalText(['"', '`', "\\'", '\\\\', '[[']).map((t) => `'${t}'`),
    literalText(['"', "'", '\\`', '${1}', '${"{/do}"}', '\n']).map(
      (t) => `\`${t}\``,
    ),
    fc
      .array(
        fc.constantFrom('a', '{', '}', '[/]', '{\\/do}', '[{/do}]', '"', '`'),
        { minLength: 1, maxLength: 4 },
      )
      .map((parts) => `/${parts.join('')}/g`),
    literalText(['"', "'", '`', '\n', '*']).map((t) => `/*${t}*/`),
    literalText(['"', "'", '`', '/']).map((t) => `//${t}\n`),
  )
  .map((lit) => `=${lit}`);

/**
 * `{do}` bodies are raw JavaScript, lexed as such: a `{/do}` inside a string,
 * template or regex literal or a comment does not end the body.
 */
const doMacroArb: fc.Arbitrary<Generated> = fc
  .tuple(
    opener('do', false),
    fc
      .array(
        fc.oneof(
          { weight: 3, arbitrary: fc.constantFrom(...DO_CODE) },
          { weight: 1, arbitrary: doLiteral },
        ),
        { maxLength: 8 },
      )
      .map((parts) => parts.join('')),
    closer('do'),
  )
  .map(([o, body, close]) => ({
    src: o.src + body + close,
    ast: [
      withSelectors(
        {
          type: 'macro',
          name: 'do',
          rawArgs: '',
          children: body ? [textNode(body)] : [],
        } as ASTNode,
        o.sel,
      ),
    ],
  }));

const BRANCHING: Record<string, string[]> = {
  if: ['elseif', 'else'],
  switch: ['case', 'default'],
  timed: ['next'],
};

const VOID_TAGS = ['br', 'hr', 'img', 'input', 'wbr'];
const CONTAINER_TAGS = [
  'span',
  'div',
  'b',
  'i',
  'em',
  'strong',
  'a',
  'p',
  'section',
  'label',
  'code',
  'ul',
  'li',
  'my-elem',
];

// A small pool of names makes duplicates (`id … ID`) likely.
const attrName = fc.oneof(
  fc.stringMatching(/^[a-zA-Z_:@][a-zA-Z0-9_:@-]{0,6}$/),
  fc.constantFrom('id', 'ID', 'title', '__proto__', 'constructor'),
);
const eqSpace = fc.constantFrom('', ' ', '\n', '\t ');

/** One attribute: source text, name and the value the tokenizer should keep. */
const attribute = fc.oneof(
  // Boolean attribute
  attrName.map((name) => ({ name, value: '', src: name, unquoted: false })),
  // Quoted value (may contain the other quote, `>`, spaces, interpolations)
  fc
    .tuple(
      attrName,
      eqSpace,
      eqSpace,
      fc.constantFrom('"', "'"),
      fc.array(
        fc.oneof(
          fc
            .string({
              unit: fc.constantFrom(...'ab =>/\'"&;\n'),
              maxLength: 4,
            })
            .map((text) => ({ text })),
          // Interpolations: quotes and braces inside their literals and
          // comments neither end the value nor the interpolation
          fc
            .tuple(
              sigil,
              identifier,
              fc.constantFrom(
                '',
                ' + "}\'"',
                ".replace(/['\"}]/g, '{')",
                " /* '} */",
                ' + `"${1}`',
              ),
            )
            .map(([s, n, rest]) => ({ interp: `{${s}${n}${rest}}` })),
        ),
        { maxLength: 3 },
      ),
    )
    .map(([name, s1, s2, q, parts]) => {
      const value = parts
        .map((p) => ('text' in p ? p.text.replaceAll(q, '') : p.interp))
        .join('');
      return {
        name,
        value,
        src: `${name}${s1}=${s2}${q}${value}${q}`,
        unquoted: false,
      };
    }),
  // Unquoted value
  fc
    .tuple(
      attrName,
      eqSpace,
      eqSpace,
      fc.stringMatching(/^[a-zA-Z0-9_.:/-]{1,6}$/),
    )
    .map(([name, s1, s2, value]) => ({
      name,
      value,
      src: `${name}${s1}=${s2}${value}`,
      unquoted: true,
    })),
);

/**
 * Attribute lists rendered with whitespace separators. Callers add a space
 * before `/>` when the last value is unquoted (`endsUnquoted`), since
 * `a=b/>` makes `b/` the value (as in HTML).
 */
const attributeList = fc.array(attribute, { maxLength: 4 }).chain((attrs) =>
  fc
    .array(fc.constantFrom(' ', '  ', '\n', '\t'), {
      minLength: attrs.length,
      maxLength: attrs.length,
    })
    .map((seps) => ({
      attrs,
      src: attrs.map((a, i) => seps[i] + a.src).join(''),
      endsUnquoted: attrs.length > 0 && attrs[attrs.length - 1]!.unquoted,
    })),
);

/** The attributes HTML keeps: the first of each case-insensitive name. */
function attrRecord(attrs: { name: string; value: string }[]) {
  const out: Record<string, string> = {};
  const seen = new Set<string>();
  for (const { name, value } of attrs) {
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    Object.defineProperty(out, name, { value, enumerable: true });
  }
  return out;
}

const voidTagArb: fc.Arbitrary<Generated> = fc
  .tuple(
    fc.constantFrom(...VOID_TAGS),
    attributeList,
    fc.constantFrom('', '/', ' /'),
    fc.boolean(),
  )
  .map(([tag, attrs, slash, redundantClose]) => {
    const s = slash === '/' && attrs.endsUnquoted ? ' /' : slash;
    return {
      src: `<${tag}${attrs.src}${s}>${redundantClose ? `</${tag}>` : ''}`,
      ast: [
        {
          type: 'html',
          tag,
          attributes: attrRecord(attrs.attrs),
          children: [],
        },
      ],
    };
  });

const selfClosedTagArb: fc.Arbitrary<Generated> = fc
  .tuple(fc.constantFrom(...CONTAINER_TAGS), attributeList)
  .map(([tag, attrs]) => ({
    src: `<${tag}${attrs.src}${attrs.endsUnquoted ? ' ' : ''}/>`,
    ast: [
      { type: 'html', tag, attributes: attrRecord(attrs.attrs), children: [] },
    ],
  }));

/** Link part: no separators, brackets, or leading selector characters. */
const linkName = fc.string({
  unit: fc.constantFrom(...'abcAZ09 _-"\'\\{}$.#!?é\n'),
  minLength: 1,
  maxLength: 8,
});

const quoteArg = (v: string) => `"${v.replace(/[\\"]/g, '\\$&')}"`;

/**
 * Links in all four forms. A selector-less link whose text starts with `.`
 * or `#` is parsed as selectors (`[[.cls Target]]`), so such names are only
 * generated after explicit selectors. Names containing `|`, `->` or `<-`
 * are ambiguous (Twine tools disagree on which separator wins), so they are
 * not generated.
 */
export const linkArb: fc.Arbitrary<
  Generated & { display: string; target: string }
> = fc
  .tuple(
    fc.constantFrom('plain', 'pipe', 'arrow', 'reverse'),
    linkName,
    linkName,
    optSelectors,
  )
  .filter(
    ([form, a, b, sel]) =>
      sel !== undefined || !/^[.#]/.test(form === 'reverse' ? b : a),
  )
  .map(([form, a, b, sel]) => {
    const inner =
      form === 'plain'
        ? a
        : form === 'pipe'
          ? `${a}|${b}`
          : form === 'arrow'
            ? `${a}->${b}`
            : `${b}<-${a}`;
    const display = a.trim();
    const target = (form === 'plain' ? a : b).trim();
    const node: MacroNode = withSelectors(
      {
        type: 'macro',
        name: 'link',
        rawArgs: `${quoteArg(display)} ${quoteArg(target)}`,
        children: [],
      },
      sel,
    );
    return {
      src: `[[${sel ? sel.src + ' ' : ''}${inner}]]`,
      ast: [node],
      display,
      target,
    };
  });

/**
 * Well-formed passages: a sequence of text, escapes, variables, expressions,
 * macros (self-closing, block, branching, raw-body), HTML elements and links,
 * nested to a bounded depth.
 */
export const passageArb: fc.Arbitrary<Generated> = fc.letrec<{
  nodes: Generated;
  node: Generated;
  block: Generated;
  branching: Generated;
  element: Generated;
}>((tie) => ({
  nodes: fc
    .array(tie('node'), { maxLength: 6, depthIdentifier: 'passage' })
    .map(concat),
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true, depthIdentifier: 'passage' },
    { weight: 5, arbitrary: textArb },
    { weight: 2, arbitrary: variableArb },
    { weight: 1, arbitrary: expressionArb },
    { weight: 1, arbitrary: selfClosingMacroArb },
    { weight: 1, arbitrary: doMacroArb },
    { weight: 1, arbitrary: linkArb },
    { weight: 1, arbitrary: voidTagArb },
    { weight: 1, arbitrary: selfClosedTagArb },
    { weight: 1, arbitrary: tie('block') },
    { weight: 1, arbitrary: tie('branching') },
    { weight: 2, arbitrary: tie('element') },
  ),
  block: fc
    .constantFrom(...BLOCK.filter((n) => !BRANCHING[n] && n !== 'do'))
    .chain((name) =>
      fc.tuple(
        fc.constant(name),
        opener(name, true),
        tie('nodes'),
        closer(name),
      ),
    )
    .map(([name, o, body, close]) => ({
      src: o.src + body.src + close,
      ast: [
        withSelectors(
          {
            type: 'macro',
            name,
            rawArgs: o.rawArgs,
            children: body.ast,
          } as ASTNode,
          o.sel,
        ),
      ],
    })),
  branching: fc
    .constantFrom(...Object.keys(BRANCHING))
    .chain((name) =>
      fc.tuple(
        fc.constant(name),
        opener(name, true),
        tie('nodes'),
        fc.array(
          fc
            .constantFrom(...BRANCHING[name]!)
            .chain((b) =>
              fc.tuple(
                opener(b, b !== 'else' && b !== 'default'),
                tie('nodes'),
              ),
            ),
          { maxLength: 2 },
        ),
        closer(name),
      ),
    )
    .map(([name, o, body, branches, close]) => {
      const first: Branch = withSelectors(
        { rawArgs: o.rawArgs, children: body.ast },
        o.sel,
      );
      const rest: Branch[] = branches.map(([bo, bbody]) =>
        withSelectors({ rawArgs: bo.rawArgs, children: bbody.ast }, bo.sel),
      );
      const node: MacroNode = {
        type: 'macro',
        name,
        rawArgs: o.rawArgs,
        children: [],
        branches: [first, ...rest],
      };
      return {
        src:
          o.src +
          body.src +
          branches.map(([bo, bbody]) => bo.src + bbody.src).join('') +
          close,
        ast: [node],
      };
    }),
  element: fc
    .tuple(
      fc.constantFrom(...CONTAINER_TAGS),
      fc.boolean(),
      attributeList,
      tie('nodes'),
      fc.constantFrom('', ' ', '\n'),
    )
    .map(([tag, upperClose, attrs, body, ws]) => ({
      src: `<${tag}${attrs.src}>${body.src}</${upperClose ? tag.toUpperCase() : tag}${ws}>`,
      ast: [
        {
          type: 'html',
          tag,
          attributes: attrRecord(attrs.attrs),
          children: body.ast,
        } as ASTNode,
      ],
    })),
})).nodes;

/** Characters and fragments that exercise every tokenizer branch. */
const MARKUP_FRAGMENTS = [
  ...'{}[]<>/\\$_@%.#"\'`|-= \nab',
  '{$x}',
  '{_t}',
  '{@l}',
  '{%tr}',
  '{if true}',
  '{else}',
  '{/if}',
  '{do}',
  '{/do}',
  '{print 1}',
  '{.c $x}',
  '[[',
  ']]',
  '[[a|b]]',
  '->',
  '<-',
  '<span>',
  '</span>',
  '<br>',
  '</br>',
  '<b class="x">',
  '</b>',
  '\\{',
  '\\\\',
];

/** Arbitrary strings, biased towards markup characters and fragments. */
export const markupNoise = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc.string({ unit: fc.constantFrom(...MARKUP_FRAGMENTS), maxLength: 30 }),
);

/** Valid passages with random edits: deletions, insertions and duplications. */
export const mutatedPassage = fc
  .tuple(
    passageArb,
    fc.array(
      fc.tuple(
        fc.constantFrom('delete', 'insert', 'duplicate'),
        fc.nat(),
        fc.nat({ max: 6 }),
        fc.constantFrom(...MARKUP_FRAGMENTS),
      ),
      { minLength: 1, maxLength: 4 },
    ),
  )
  .map(([p, edits]) => {
    let s = p.src;
    for (const [kind, at, len, frag] of edits) {
      const i = s.length === 0 ? 0 : at % (s.length + 1);
      if (kind === 'delete') s = s.slice(0, i) + s.slice(i + len);
      else if (kind === 'insert') s = s.slice(0, i) + frag + s.slice(i);
      else s = s.slice(0, i) + s.slice(i, i + len) + s.slice(i);
    }
    return s;
  });

/** Vitest timeout for a property, scaled so deep FC_NUM_RUNS runs fit. */
export function propTimeout(msPerRun: number): number {
  return Math.max(5000, NUM_RUNS * msPerRun);
}
