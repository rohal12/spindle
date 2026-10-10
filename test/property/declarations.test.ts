/**
 * parseDeclarations reads StoryVariables initializers without running them;
 * where it can tell, it agrees with parseStoryVariables, which does (#466).
 */
import { describe, expect } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import {
  parseDeclarations,
  parseStoryVariables,
  type Declaration,
} from '../../src/story-variables';
import { fcOptions } from './config';

const KEYS = ['a', 'b', '"c"', '1', '2', '0x3', "'a'", 'a'];

/** Initializers made of literals, so their value is known without running. */
const literal = fc.letrec<{ [name: string]: string }>((tie) => ({
  leaf: fc.constantFrom(
    '1',
    '-2.5',
    '+3',
    '0x10',
    'NaN',
    'Infinity',
    '"s"',
    "'t'",
    '`u`',
    'true',
    'null',
    '[]',
    '[undefined, 1]',
    'undefined',
    'void 0',
    '1n',
    '-1n',
    '0x1Fn',
    '+1n',
    '() => 1',
    'x => x',
    'function () { return 1 }',
    'function () { return 1 }()',
    '(() => ({}))()',
    'class A {}',
    '1 + 2',
    '(1',
    '1 2',
  ),
  member: fc.oneof(
    fc
      .tuple(fc.constantFrom(...KEYS), tie('value'))
      .map(([key, value]) => `${key}: ${value}`),
    fc.constantFrom('f() { return 1 }', 'a', '...{ a: [] }', '...{}', '[k]: 1'),
  ),
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    tie('leaf'),
    fc
      .array(tie('member'), { maxLength: 4 })
      .map((members) => `{ ${members.join(', ')} }`),
  ),
})).value as fc.Arbitrary<string>;

/** Whether an initializer can be run without a reference to anything. */
function runs(expr: string): 'ok' | string {
  try {
    parseStoryVariables(`$x = ${expr}`);
    return 'ok';
  } catch (err) {
    return (err as Error).message;
  }
}

/** The type of the value at `path` of the initializer, as the runtime sees it. */
function runtimeType(expr: string, path: string[]): string | undefined {
  let value: unknown = new Function(`return (${expr})`)();
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value === null
    ? 'null'
    : Array.isArray(value)
      ? 'array'
      : typeof value;
}

describe('parseDeclarations against parseStoryVariables', () => {
  test.prop([literal], fcOptions)(
    'agree on what an initializer cannot be',
    (expr) => {
      const { errors, declarations } = parseDeclarations(`$x = ${expr}`);
      const outcome = runs(expr);
      // A reference or a call is only known by running it: a rejection
      // for that reason has no error here
      const unknown = /is not defined|is not a function/.test(outcome);
      if (outcome === 'ok') {
        expect(errors).toEqual([]);
      } else if (!unknown && !expr.includes('...')) {
        // (a spread can replace what is before it: only the runtime knows)
        expect(errors).toHaveLength(1);
        expect(errors[0]!.code).not.toBe('invalid-declaration');
        // The message is the runtime's, or the parser's for a syntax error
        if (errors[0]!.code === 'unsupported-value') {
          expect(outcome).toBe(`StoryVariables: ${errors[0]!.message}`);
        }
      }
      expect(declarations).toHaveLength(1);
    },
  );

  test.prop([literal], fcOptions)(
    'give a schema that is the runtime value',
    (expr) => {
      if (runs(expr) !== 'ok') return;
      const [declaration] = parseDeclarations(`$x = ${expr}`).declarations;
      const check = (schema: Declaration['schema'], path: string[]) => {
        if (!schema) return;
        expect(runtimeType(expr, path)).toBe(schema.type);
        for (const [key, field] of schema.fields ?? []) {
          check(field, [...path, key]);
        }
      };
      check(declaration!.schema, []);
    },
  );
});
