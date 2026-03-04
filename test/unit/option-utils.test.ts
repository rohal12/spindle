import { describe, it, expect } from 'vitest';
import { extractOptions } from '../../src/components/macros/option-utils';
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
});
