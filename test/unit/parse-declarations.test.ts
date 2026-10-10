import { describe, it, expect } from 'vitest';
import {
  parseDeclarations,
  parseStoryVariables,
  type FieldSchema,
} from '../../src/story-variables';

const slice = (content: string, start: number, end: number) =>
  content.slice(start, end);

/** A schema as plain data, to compare. */
const plain = (schema: FieldSchema | undefined): unknown =>
  schema && {
    type: schema.type,
    ...(schema.fields && {
      fields: Object.fromEntries(
        [...schema.fields].map(([k, v]) => [k, plain(v)]),
      ),
    }),
  };

describe('parseDeclarations (#449)', () => {
  it('reads every declaration with the spans of its name and value', () => {
    const content = '$hp = 100\n  $name   =  "Hero"  \n\n$pc = { a: [1, 2] }\n';
    const { declarations, errors } = parseDeclarations(content);
    expect(errors).toEqual([]);
    expect(declarations.map((d) => d.name)).toEqual(['hp', 'name', 'pc']);
    for (const d of declarations) {
      expect(slice(content, d.nameStart, d.nameEnd)).toBe(d.name);
    }
    expect(
      declarations.map((d) => slice(content, d.valueStart, d.valueEnd)),
    ).toEqual(['100', '"Hero"', '{ a: [1, 2] }']);
  });

  it('returns every valid declaration and every error, never throwing', () => {
    const content = '$a = 1\nnot a declaration\n$b = 2\n$a-b = 3\n$c = 3';
    const { declarations, errors } = parseDeclarations(content);
    expect(declarations.map((d) => d.name)).toEqual(['a', 'b', 'c']);
    expect(
      errors.map((e) => [e.code, slice(content, e.offset, e.end)]),
    ).toEqual([
      ['invalid-declaration', 'not a declaration'],
      // A name must start with a letter or underscore
      ['invalid-declaration', '$a-b = 3'],
    ]);
    expect(errors[0]!.message).toBe(
      'Invalid declaration: "not a declaration". Expected: $name = value',
    );
    // parseStoryVariables throws the first, as before
    expect(() => parseStoryVariables(content)).toThrow(
      'StoryVariables: Invalid declaration: "not a declaration". Expected: $name = value',
    );
  });

  it('reports a name that cannot be a variable at the name', () => {
    const content = '$ok = 1\n$__proto__ = 2';
    const { declarations, errors } = parseDeclarations(content);
    expect(declarations.map((d) => d.name)).toEqual(['ok']);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.code).toBe('invalid-name');
    expect(slice(content, errors[0]!.offset, errors[0]!.end)).toBe('__proto__');
    expect(() => parseStoryVariables(content)).toThrow(
      `StoryVariables: ${errors[0]!.message}`,
    );
  });

  it('handles CRLF line ends', () => {
    const content = '$a = 1\r\n$b = "x"\r\n\r\n$c = [1]\r\n';
    const { declarations, errors } = parseDeclarations(content);
    expect(errors).toEqual([]);
    expect(
      declarations.map((d) => slice(content, d.valueStart, d.valueEnd)),
    ).toEqual(['1', '"x"', '[1]']);
    expect(declarations.map((d) => plain(d.schema))).toEqual([
      { type: 'number' },
      { type: 'string' },
      { type: 'array' },
    ]);
  });

  it('counts offsets in UTF-16 code units', () => {
    const content =
      '$ge = "\u{1F600}"\n$\u{1F600}x = 1\n$c = "\u{1F600}\u{1F600}"';
    const { declarations, errors } = parseDeclarations(content);
    expect(errors.map((e) => e.code)).toEqual(['invalid-declaration']);
    expect(declarations.map((d) => d.name)).toEqual(['ge', 'c']);
    const c = declarations[1]!;
    expect(slice(content, c.valueStart, c.valueEnd)).toBe(
      '"\u{1F600}\u{1F600}"',
    );
  });

  it('keeps both declarations of a name, and reports the second', () => {
    const content = '$a = 1\n$b = 2\n$a = "x"';
    const { declarations, errors } = parseDeclarations(content);
    expect(declarations.map((d) => d.name)).toEqual(['a', 'b', 'a']);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'duplicate-declaration',
      message: 'Duplicate declaration of $a',
    });
    expect(slice(content, errors[0]!.offset, errors[0]!.end)).toBe('a');
    expect(errors[0]!.offset).toBe(content.lastIndexOf('a'));
    // Evaluated, the later one wins, as before
    expect(parseStoryVariables(content).get('a')).toMatchObject({
      type: 'string',
      default: 'x',
    });
  });

  it('reads transients with the % sigil', () => {
    const content = '%npcs = []\n$not = 1\n%n = 2';
    const { declarations, errors } = parseDeclarations(content, '%');
    expect(declarations.map((d) => d.name)).toEqual(['npcs', 'n']);
    expect(errors.map((e) => e.code)).toEqual(['invalid-declaration']);
    expect(
      slice(content, declarations[0]!.nameStart, declarations[0]!.nameEnd),
    ).toBe('npcs');
  });

  it('does not evaluate the initializers', () => {
    const g = globalThis as { __evaluated?: number };
    g.__evaluated = 0;
    const { declarations, errors } = parseDeclarations(
      '$a = (globalThis.__evaluated = 1)\n$b = (() => { throw new Error("no") })()\n$c = new Date()',
    );
    expect(g.__evaluated).toBe(0);
    expect(errors).toEqual([]);
    expect(declarations.map((d) => d.schema)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    delete g.__evaluated;
  });

  describe('the schema of a static initializer', () => {
    // What evaluating gives, for the same text
    const samples = [
      '0',
      '-5',
      '+1.5e3',
      '0xFF',
      '1_000',
      '.5',
      'NaN',
      '-Infinity',
      '"text"',
      "'it\\'s'",
      '`plain`',
      'true',
      'false',
      'null',
      '[]',
      '[1, "a", [2, 3], { b: 1 }]',
      '[ /* c */ 1 ]',
      '{}',
      '{ a: 1, b: "x", c: [1], d: { e: true, f: null } }',
      '{ "quoted key": 1, 2: "n", $d: 3 }',
      '{ a: 1, // trailing comment\n b: 2, }',
      '{ a: 1 + 2, b: foo(), c: 3 }',
      '{ ...other, a: 1 }',
      '{ [computed]: 1, a: 2 }',
      '{ short, a: 2 }',
    ];

    it.each(samples)('is what evaluating %s gives', (sample) => {
      const content = `$x = ${sample}`;
      // Some samples refer to names that do not exist: evaluate with them
      const declared = parseDeclarations(content).declarations[0]!;
      const expected = (() => {
        try {
          return plain(parseStoryVariables(content).get('x'));
        } catch {
          return 'does not evaluate';
        }
      })();
      if (expected === 'does not evaluate') {
        // Not static, or a reference: it has no schema, or only its static members
        expect(declared.schema?.type ?? 'object').toBe('object');
        return;
      }
      const got = plain(declared.schema) as {
        fields?: Record<string, unknown>;
      };
      expect(got.fields ? Object.keys(got.fields) : []).toEqual(
        Object.keys((expected as typeof got).fields ?? {}),
      );
      expect(got).toEqual(expected);
    });

    it('has no schema for what is not static', () => {
      const content = [
        '$a = 1 + 2',
        '$b = Math.PI',
        '$c = new Date()',
        '$d = (1)',
        '$e = [1].length',
        '$f = -x',
        '$g = `a${1}`',
        '$h = otherVariable',
        '$i = "a" + "b"',
      ].join('\n');
      const { declarations, errors } = parseDeclarations(content);
      expect(errors).toEqual([]);
      expect(declarations.map((d) => d.schema)).toEqual(
        declarations.map(() => undefined),
      );
    });

    it('keeps the static members of an object with others', () => {
      const [d] = parseDeclarations(
        '$o = { a: 1, b: foo(), c: [2], ...x }',
      ).declarations;
      expect(plain(d!.schema)).toEqual({
        type: 'object',
        fields: { a: { type: 'number' }, c: { type: 'array' } },
      });
    });
  });

  describe('values no variable can hold', () => {
    it.each([
      ['undefined', 'undefined'],
      ['function () {}', 'function'],
      ['() => 1', 'function'],
      ['async (x) => x', 'function'],
      ['x => x', 'function'],
      ['class A {}', 'function'],
      ['10n', 'bigint'],
      ['{ a: 1, b: undefined }', 'undefined'],
      ['{ f() { return 1 } }', 'function'],
      ['{ a: () => 1 }', 'function'],
    ])('are errors: %s', (value, type) => {
      const content = `$ok = 1\n$x = ${value}`;
      const { declarations, errors } = parseDeclarations(content);
      expect(declarations.map((d) => d.name)).toEqual(['ok', 'x']);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('unsupported-value');
      expect(errors[0]!.message).toContain(`Unsupported type "${type}"`);
      expect(slice(content, errors[0]!.offset, errors[0]!.end)).toBe(value);
    });

    it('is left to the evaluation in parseStoryVariables', () => {
      expect(() => parseStoryVariables('$x = undefined')).toThrow(
        'StoryVariables: Unsupported type "undefined" for value undefined. Expected number, string, boolean, array, or object.',
      );
    });
  });
});
