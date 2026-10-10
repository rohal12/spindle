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
        '$o = { a: 1, b: foo(), c: [2], d: 4 }',
      ).declarations;
      expect(plain(d!.schema)).toEqual({
        type: 'object',
        fields: {
          a: { type: 'number' },
          c: { type: 'array' },
          d: { type: 'number' },
        },
      });
    });

    it.each([
      ['a spread', '{ a: 1, ...{ a: { b: 1 } } }', {}],
      ['a spread, then members', '{ a: 1, ...x, b: "s" }', { b: 'string' }],
      ['a computed key', '{ a: 1, ["a"]: { b: 1 } }', {}],
      ['a shorthand member of the same name', '{ a: 1, a }', {}],
      ['a later member that is not static', '{ a: 1, a: foo() }', {}],
      ['an accessor', '{ a: 1, get a() { return {} } }', {}],
    ])('has no field a later member can replace: %s (#466)', (_, v, fields) => {
      const [d] = parseDeclarations(`$o = ${v}`).declarations;
      expect(plain(d!.schema)).toEqual({
        type: 'object',
        fields: Object.fromEntries(
          Object.entries(fields).map(([k, type]) => [k, { type }]),
        ),
      });
    });

    it('takes the last of equal keys, and numbers as the runtime names them', () => {
      const [d] = parseDeclarations(
        '$o = { a: "s", a: 1, 0x10: true, "b\\n": null }',
      ).declarations;
      expect(plain(d!.schema)).toEqual({
        type: 'object',
        fields: {
          a: { type: 'number' },
          '16': { type: 'boolean' },
          'b\n': { type: 'null' },
        },
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
  describe('agreement with the runtime (#466)', () => {
    const only = (value: string) => {
      const { errors, declarations } = parseDeclarations(`$x = ${value}`);
      return { errors, declarations };
    };

    it.each([
      '{ a: undefined, a: 1 }',
      '{ f() {}, f: 2 }',
      'function () { return 1 }()',
      '(function () {}).length',
      '(() => 1)()',
      'x => x, 1',
    ])('is no error when the value is allowed: %s', (value) => {
      expect(only(value).errors).toEqual([]);
      expect(() => parseStoryVariables(`$x = ${value}`)).not.toThrow(
        'Unsupported',
      );
    });

    it('reports a value by what the runtime found, not by the initializer', () => {
      const message = (value: string) => only(value).errors[0]!.message;
      expect(message('{ a: { b: undefined } }')).toContain(
        'for value undefined.',
      );
      expect(message('{ a: 1, b: 0x10n }')).toContain(
        'Unsupported type "bigint" for value 16.',
      );
      expect(message('{ a: 1, b: x => x + 1, c: 2 }')).toContain(
        'Unsupported type "function" for value x => x + 1.',
      );
      expect(message('{ f(a) { return a } }')).toContain(
        'for value f(a) { return a }.',
      );
      // The first the runtime meets: array indices come first
      expect(message('{ a: undefined, 1: () => 1 }')).toContain(
        'Unsupported type "function"',
      );
      expect(message('-5n')).toContain('for value -5.');
      for (const value of ['{ a: { b: undefined } }', '{ a: 1, b: 0x10n }']) {
        expect(() => parseStoryVariables(`$x = ${value}`)).toThrow(
          `StoryVariables: ${message(value)}`,
        );
      }
    });

    it('reports +1n as the evaluation error it is', () => {
      const [error] = only('+1n').errors;
      expect(error).toMatchObject({
        code: 'unsupported-value',
        message:
          'Failed to evaluate "$x = +1n": Cannot convert a BigInt value to a number',
      });
      expect(() => parseStoryVariables('$x = +1n')).toThrow(
        `StoryVariables: ${error!.message}`,
      );
      expect(only('-1n').errors[0]!.message).toContain('bigint');
    });

    it.each(['void 0', 'void "x"', '{ a: void 0 }'])(
      'reads %s as undefined',
      (value) => {
        const [error] = only(value).errors;
        expect(error!.code).toBe('unsupported-value');
        expect(error!.message).toContain('Unsupported type "undefined"');
      },
    );

    it('does not read `void 0 + 1` or `void 0 ? 1 : 2` as undefined', () => {
      expect(only('void 0 + 1').errors).toEqual([]);
      expect(only('void 0 ? 1 : 2').errors).toEqual([]);
    });
  });

  describe('syntax errors (#466)', () => {
    it.each([
      ['(1', 1],
      ['1 2', 2],
      ['{ a: 1 b: 2 }', 7],
      ['[1, 2', 4],
      ['"open', 0],
    ])('reports `%s` as a syntax error at %i of the initializer', (v, at) => {
      const content = `$ok = 1\n$x = ${v}`;
      const { declarations, errors } = parseDeclarations(content);
      expect(declarations.map((d) => d.name)).toEqual(['ok', 'x']);
      expect(declarations[1]!.schema).toBeUndefined();
      expect(errors).toHaveLength(1);
      expect(errors[0]!.code).toBe('syntax');
      expect(errors[0]!.message).toContain(`Failed to evaluate "$x = ${v}"`);
      const valueStart = declarations[1]!.valueStart;
      expect(errors[0]!.offset).toBe(valueStart + Math.min(at, v.length - 1));
      expect(errors[0]!.end).toBe(errors[0]!.offset + 1);
      // The runtime rejects it too, and with this message
      expect(() => parseStoryVariables(content)).toThrow(
        'StoryVariables: Failed to evaluate "$x = ' + v + '"',
      );
    });

    it('reads what the runtime evaluates, not what looks balanced', () => {
      // `return (1) + (2)` is well-formed, and a comment swallows the `)`
      expect(parseDeclarations('$x = 1) + (2').errors).toEqual([]);
      expect(parseDeclarations('$x = 1 // c').errors[0]!.code).toBe('syntax');
    });

    it('works for transients too', () => {
      const { errors } = parseDeclarations('%t = (', '%');
      expect(errors[0]).toMatchObject({ code: 'syntax' });
      expect(errors[0]!.message).toContain('"%t = ("');
    });
  });
});
