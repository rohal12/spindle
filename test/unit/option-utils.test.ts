import { describe, it, expect } from 'vitest';
import {
  extractOptions,
  parseVarArgs,
} from '../../src/components/macros/option-utils';
import { parseCheckboxLabel } from '../../src/components/macros/Checkbox';
import { parseRadioArgs } from '../../src/components/macros/Radiobutton';
import type { ASTNode } from '../../src/markup/ast';

describe('extractOptions', () => {
  it('extracts rawArgs from option macro nodes', () => {
    const children: ASTNode[] = [
      { type: 'macro', name: 'option', rawArgs: 'Red', children: [] },
      { type: 'macro', name: 'option', rawArgs: 'Green', children: [] },
      { type: 'macro', name: 'option', rawArgs: 'Blue', children: [] },
    ];
    expect(extractOptions(children)).toEqual(['Red', 'Green', 'Blue']);
  });

  it('ignores non-option nodes', () => {
    const children: ASTNode[] = [
      { type: 'text', value: 'some text' },
      { type: 'macro', name: 'option', rawArgs: 'Apple', children: [] },
      { type: 'macro', name: 'set', rawArgs: '$x = 1', children: [] },
      { type: 'macro', name: 'option', rawArgs: 'Banana', children: [] },
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

  it('trims whitespace from option rawArgs', () => {
    const children: ASTNode[] = [
      { type: 'macro', name: 'option', rawArgs: '  Spaced  ', children: [] },
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

  it('does not strip mismatched quotes', () => {
    const children: ASTNode[] = [
      { type: 'macro', name: 'option', rawArgs: '"Mismatched\'', children: [] },
    ];
    expect(extractOptions(children)).toEqual(['"Mismatched\'']);
  });

  it('leaves unquoted values unchanged', () => {
    const children: ASTNode[] = [
      { type: 'macro', name: 'option', rawArgs: 'plain', children: [] },
    ];
    expect(extractOptions(children)).toEqual(['plain']);
  });

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
  it('reads a multi-line option value, even loosely quoted', () => {
    const option = (rawArgs: string): ASTNode => ({
      type: 'macro',
      name: 'option',
      rawArgs,
      children: [],
    });
    expect(extractOptions([option('"Long\nSword"')])).toEqual(['Long\nSword']);
    expect(extractOptions([option('"Long\nSword\\"')])).toEqual([
      'Long\nSword\\',
    ]);
  });

  it('reads a multi-line checkbox label', () => {
    expect(parseCheckboxLabel('$agree "I\nagree"')).toBe('I\nagree');
    expect(parseCheckboxLabel('$agree "\r\n"')).toBe('\r\n');
    expect(parseCheckboxLabel('$agree I\nagree')).toBe('I\nagree');
  });

  it('reads a checkbox label with a long run of spaces in linear time', () => {
    const time = (n: number) => {
      const args = `$agree "a${' '.repeat(n)}b"  `;
      let best = Infinity;
      for (let run = 0; run < 3; run++) {
        const t0 = performance.now();
        expect(parseCheckboxLabel(args)).toBe(`a${' '.repeat(n)}b`);
        best = Math.min(best, performance.now() - t0);
      }
      return best;
    };
    // 8× the input may take 8× the time, not the 64× of a quadratic scan
    expect(time(32000)).toBeLessThan(Math.max(time(4000), 0.5) * 24);
    expect(parseCheckboxLabel('$agree Yes \t\n')).toBe('Yes');
  });

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
