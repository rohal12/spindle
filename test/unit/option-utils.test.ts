import { describe, it, expect } from 'vitest';
import {
  extractOptions,
  parseVarArgs,
} from '../../src/components/macros/option-utils';
import { parseCheckboxLabel, parseRadioArgs } from '../support/macro-args';
import { MacroArgumentError } from '../../src/components/macros/macro-args';
import type { ASTNode } from '../../src/markup/ast';
import { expectAboutLinear, LINEAR_TIMEOUT } from '../support/linear-time';

describe('extractOptions', () => {
  it('extracts rawArgs from option macro nodes', () => {
    const children: ASTNode[] = [
      { type: 'macro', name: 'option', rawArgs: '"Red"', children: [] },
      { type: 'macro', name: 'option', rawArgs: '"Green"', children: [] },
      { type: 'macro', name: 'option', rawArgs: '"Blue"', children: [] },
    ];
    expect(extractOptions(children)).toEqual(['Red', 'Green', 'Blue']);
  });

  it('ignores non-option nodes', () => {
    const children: ASTNode[] = [
      { type: 'text', value: 'some text' },
      { type: 'macro', name: 'option', rawArgs: '"Apple"', children: [] },
      { type: 'macro', name: 'set', rawArgs: '$x = 1', children: [] },
      { type: 'macro', name: 'option', rawArgs: '"Banana"', children: [] },
    ];
    expect(extractOptions(children)).toEqual(['Apple', 'Banana']);
  });

  it('returns empty array when no options', () => {
    const children: ASTNode[] = [{ type: 'text', value: 'no options here' }];
    expect(extractOptions(children)).toEqual([]);
  });

  it('returns empty array for empty children', () => {
    expect(extractOptions([])).toEqual([]);
  });

  it('trims whitespace around a quoted value', () => {
    const children: ASTNode[] = [
      { type: 'macro', name: 'option', rawArgs: '  "Spaced"  ', children: [] },
    ];
    expect(extractOptions(children)).toEqual(['Spaced']);
  });

  it('strips surrounding double quotes from option rawArgs', () => {
    const children: ASTNode[] = [
      { type: 'macro', name: 'option', rawArgs: '"Long Sword"', children: [] },
      { type: 'macro', name: 'option', rawArgs: '"Short Bow"', children: [] },
    ];
    expect(extractOptions(children)).toEqual(['Long Sword', 'Short Bow']);
  });

  it('strips surrounding single quotes from option rawArgs', () => {
    const children: ASTNode[] = [
      { type: 'macro', name: 'option', rawArgs: "'Fire Staff'", children: [] },
    ];
    expect(extractOptions(children)).toEqual(['Fire Staff']);
  });

  it.each(['"Mismatched\'', 'plain', 'two words'])(
    'rejects a value that is not one quoted string: %s',
    (rawArgs) => {
      const children: ASTNode[] = [
        { type: 'macro', name: 'option', rawArgs, children: [] },
      ];
      expect(() => extractOptions(children)).toThrow(MacroArgumentError);
    },
  );

  it('unescapes quotes and backslashes in a quoted value', () => {
    const option = (rawArgs: string): ASTNode => ({
      type: 'macro',
      name: 'option',
      rawArgs,
      children: [],
    });
    expect(
      extractOptions([
        option(String.raw`"Say \"hi\""`),
        option(String.raw`'It\'s'`),
        option(String.raw`"C:\\"`),
      ]),
    ).toEqual(['Say "hi"', "It's", 'C:\\']);
  });
});

describe('parseVarArgs', () => {
  it('reads the variable and quoted placeholder', () => {
    expect(parseVarArgs('$name "Enter name"')).toEqual({
      varName: '$name',
      placeholder: 'Enter name',
    });
    expect(parseVarArgs(`"$name" 'Enter name'`)).toEqual({
      varName: '$name',
      placeholder: 'Enter name',
    });
  });

  it('reads a variable without a placeholder', () => {
    expect(parseVarArgs('$pc.name')).toEqual({
      varName: '$pc.name',
      placeholder: '',
    });
  });

  it('unescapes quotes and backslashes in the placeholder', () => {
    expect(parseVarArgs(String.raw`$name "Say \"hi\""`).placeholder).toBe(
      'Say "hi"',
    );
    expect(parseVarArgs(String.raw`$path "C:\\"`).placeholder).toBe('C:\\');
  });

  it('reads a placeholder that spans lines', () => {
    // Property-test counterexample: the placeholder pattern stopped at a
    // line break, so the whole argument became the variable name.
    expect(parseVarArgs('$name "\n"')).toEqual({
      varName: '$name',
      placeholder: '\n',
    });
    expect(parseVarArgs('$name "First\r\nLast"').placeholder).toBe(
      'First\r\nLast',
    );
  });
});

describe('quoted labels that span lines', () => {
  it('reads a multi-line option value, but not a loosely quoted one', () => {
    const option = (rawArgs: string): ASTNode => ({
      type: 'macro',
      name: 'option',
      rawArgs,
      children: [],
    });
    expect(extractOptions([option('"Long\nSword"')])).toEqual(['Long\nSword']);
    expect(() => extractOptions([option('"Long\nSword\\"')])).toThrow(
      MacroArgumentError,
    );
  });

  it('reads a multi-line checkbox label', () => {
    expect(parseCheckboxLabel('$agree "I\nagree"')).toBe('I\nagree');
    expect(parseCheckboxLabel('$agree "\r\n"')).toBe('\r\n');
    expect(parseCheckboxLabel('$agree I\nagree')).toBe('I\nagree');
  });

  it(
    'reads a checkbox label with a long run of spaces in linear time',
    () => {
      const parse = (n: number) => {
        const args = `$agree "a${' '.repeat(n)}b"  `;
        return () =>
          expect(parseCheckboxLabel(args)).toBe(`a${' '.repeat(n)}b`);
      };
      // 8× the input may take about 8× the time, not a quadratic scan's 64×
      expectAboutLinear(parse(4000), parse(32000));
      expect(parseCheckboxLabel('$agree Yes \t\n')).toBe('Yes');
    },
    LINEAR_TIMEOUT,
  );

  it('reads a multi-line radiobutton value and label', () => {
    expect(parseRadioArgs('$c "a\nb" "Line\nbreak"')).toEqual({
      value: 'a\nb',
      label: 'Line\nbreak',
    });
    expect(parseRadioArgs('$c "a\nb" Line\nbreak')).toEqual({
      value: 'a\nb',
      label: 'Line\nbreak',
    });
  });
});
