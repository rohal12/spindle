import { describe, it, expect } from 'vitest';
import {
  evaluatePassageName,
  parseMacroArgs,
  readBoundVariable,
} from '../../src/components/macros/macro-args';

describe('parseMacroArgs', () => {
  it('gives the last parameter the rest of the arguments', () => {
    expect(
      parseMacroArgs('$hp $str * 2', [{ name: 'target' }, { name: 'amount' }]),
    ).toEqual({ target: '$hp', amount: '$str * 2' });
  });

  it('gives the last expression or text parameter what the others leave', () => {
    const params = [
      { name: 'current', type: 'expression' },
      { name: 'max', type: 'expression' },
      { name: 'label', type: 'string' },
    ] as const;
    expect(parseMacroArgs('$a $b + 1 "HP"', params)).toEqual({
      current: '$a',
      max: '$b + 1',
      label: 'HP',
    });
    // A string after an operator is an operand
    expect(parseMacroArgs('$a $b ?? "5"', params)).toEqual({
      current: '$a',
      max: '$b ?? "5"',
      label: undefined,
    });
  });

  it('keeps quoted strings and brackets in one term', () => {
    expect(
      parseMacroArgs(`"a b" [1, 2] 'c "d"'`, [
        { name: 'first', type: 'string' },
        { name: 'second' },
        { name: 'third', type: 'text' },
      ]),
    ).toEqual({ first: 'a b', second: '[1, 2]', third: 'c "d"' });
  });

  it('reads text loosely and strings strictly', () => {
    const text = [{ name: 'label', type: 'text' }] as const;
    const string = [{ name: 'label', type: 'string' }] as const;
    expect(parseMacroArgs(String.raw`"Say \"hi\""`, text).label).toBe(
      'Say "hi"',
    );
    expect(parseMacroArgs('"Red', text).label).toBe('Red');
    expect(parseMacroArgs('Go now', text).label).toBe('Go now');
    expect(parseMacroArgs('Go now', string).label).toBeUndefined();
  });

  it('takes flags off either end', () => {
    const params = [
      { name: 'inline', type: 'flag' },
      { name: 'passage', type: 'expression' },
    ] as const;
    expect(parseMacroArgs('"A" inline', params)).toEqual({
      inline: true,
      passage: '"A"',
    });
    expect(parseMacroArgs('inline "A"', params)).toEqual({
      inline: true,
      passage: '"A"',
    });
    expect(parseMacroArgs('"a" + inline', params)).toEqual({
      inline: false,
      passage: '"a" + inline',
    });
  });

  it('splits at separators', () => {
    const loop = [
      { name: 'variables', type: 'names' },
      { name: 'of', type: 'separator' },
      { name: 'list', type: 'expression' },
    ] as const;
    expect(parseMacroArgs('@item, @i of $list', loop)).toEqual({
      variables: ['@item', '@i'],
      of: true,
      list: '$list',
    });
    expect(parseMacroArgs('@item in $list', loop)).toEqual({
      variables: ['@item in $list'],
      of: false,
      list: undefined,
    });

    const assignment = [
      { name: 'target', type: 'variable' },
      { name: '=', type: 'separator' },
      { name: 'expression', type: 'expression' },
    ] as const;
    expect(parseMacroArgs('$x = $a == 1 || $b != 2', assignment)).toEqual({
      target: '$x',
      '=': true,
      expression: '$a == 1 || $b != 2',
    });
    expect(parseMacroArgs('$x == 1', assignment)['=']).toBe(false);
  });

  it('reads delays, numbers and options', () => {
    expect(
      parseMacroArgs('2s 5', [
        { name: 'delay', type: 'delay' },
        { name: 'count', type: 'number' },
      ]),
    ).toEqual({ delay: 2000, count: 5 });
    expect(
      parseMacroArgs('"$x" goto "A" priority 3 once other "B"', [
        { name: 'condition', type: 'string' },
        {
          name: 'options',
          type: 'options',
          parameters: [
            { name: 'goto', type: 'string' },
            { name: 'priority', type: 'number' },
            { name: 'once', type: 'flag' },
          ],
        },
      ]),
    ).toEqual({
      condition: '$x',
      options: { goto: 'A', priority: 3, once: true },
    });
  });

  it('leaves missing arguments unset', () => {
    expect(
      parseMacroArgs('', [
        { name: 'a' },
        { name: 'b', type: 'flag' },
        { name: 'c', type: 'options' },
      ]),
    ).toEqual({ a: undefined, b: false, c: {} });
  });
});

describe('readBoundVariable', () => {
  it('reads the first term', () => {
    expect(readBoundVariable(' "$name" "Enter name"')).toBe('"$name"');
    expect(readBoundVariable('')).toBe('');
  });
});

describe('evaluatePassageName', () => {
  it('falls back to the text when the expression does not evaluate', () => {
    const evaluate = (expr: string) => {
      if (expr.includes("'s")) throw new SyntaxError('bad');
      return `[${expr}]`;
    };
    expect(evaluatePassageName('$x', evaluate)).toBe('[$x]');
    expect(evaluatePassageName("Bob's room", evaluate)).toBe("Bob's room");
  });
});
