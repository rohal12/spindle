import { describe, it, expect } from 'vitest';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import type { ASTNode } from '../../src/markup/ast';

describe('astContainsChildren', () => {
  it('returns true when @children is a direct child', () => {
    const nodes: ASTNode[] = [
      { type: 'text', value: 'Hello ' },
      { type: 'variable', name: 'children', scope: 'local' },
    ];
    expect(astContainsChildren(nodes)).toBe(true);
  });

  it('returns false when no @children present', () => {
    const nodes: ASTNode[] = [
      { type: 'text', value: 'Hello' },
      { type: 'variable', name: 'title', scope: 'local' },
    ];
    expect(astContainsChildren(nodes)).toBe(false);
  });

  it('returns false for $children (wrong scope)', () => {
    const nodes: ASTNode[] = [
      { type: 'variable', name: 'children', scope: 'variable' },
    ];
    expect(astContainsChildren(nodes)).toBe(false);
  });

  it('finds @children nested inside HTML element', () => {
    const nodes: ASTNode[] = [
      {
        type: 'html',
        tag: 'div',
        attributes: {},
        children: [
          { type: 'variable', name: 'children', scope: 'local' },
        ],
      },
    ];
    expect(astContainsChildren(nodes)).toBe(true);
  });

  it('finds @children nested inside macro branches', () => {
    const nodes: ASTNode[] = [
      {
        type: 'macro',
        name: 'if',
        rawArgs: '$x > 0',
        children: [],
        branches: [
          {
            rawArgs: '$x > 0',
            children: [
              { type: 'variable', name: 'children', scope: 'local' },
            ],
          },
        ],
      },
    ];
    expect(astContainsChildren(nodes)).toBe(true);
  });

  it('finds @children nested inside macro children (non-branching)', () => {
    const nodes: ASTNode[] = [
      {
        type: 'macro',
        name: 'for',
        rawArgs: '@item of $list',
        children: [
          { type: 'variable', name: 'children', scope: 'local' },
        ],
      },
    ];
    expect(astContainsChildren(nodes)).toBe(true);
  });

  it('returns false for empty nodes array', () => {
    expect(astContainsChildren([])).toBe(false);
  });
});
