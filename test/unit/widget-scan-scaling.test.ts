import { afterEach, expect, it, vi } from 'vitest';
import * as registry from '../../src/registry';
import type { ASTNode } from '../../src/markup/ast';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import { widgetDefinitions } from '../../src/widgets/widget-def';

afterEach(() => vi.restoreAllMocks());

it.each([250, 1000])(
  'reads metadata linearly with %i definitions and calls in AST and discovery scans (#783)',
  (n) => {
    let reads = 0;
    const metadata: registry.MacroMetadata[] = Array.from(
      { length: n },
      (_, i) => ({
        name: `m${i}`,
        source: 'user',
        block: false,
        subMacros: [],
        get parameters(): registry.ParameterDef[] {
          reads++;
          return [{ name: 'label', type: 'text', holds: 'markup' }];
        },
      }),
    );
    vi.spyOn(registry, 'getMacroRegistry').mockReturnValue(metadata);
    const nodes: ASTNode[] = Array.from({ length: n }, () => ({
      type: 'macro',
      name: 'm0',
      rawArgs: '"ordinary"',
      children: [],
    }));
    // Put a slot in a nested label at the end of the scan, forcing it to read
    // every body call and recurse while retaining the same metadata snapshot.
    nodes.unshift({
      type: 'macro',
      name: 'm0',
      rawArgs: '"{@children}"',
      children: [],
    });
    expect(astContainsChildren(nodes)).toBe(true);
    expect(reads).toBeLessThan(n * 10);

    reads = 0;
    const defs = widgetDefinitions([
      {
        name: 'StoryInit',
        content:
          '{widget "large"}' +
          '{m0 "ordinary"}'.repeat(n) +
          '{m0 "{@children}"}{/widget}',
      },
    ]);
    expect(defs).toMatchObject([{ name: 'large', block: true }]);
    expect(reads).toBeLessThan(n * 10);
  },
);

it('refreshes metadata between scans, including effective source precedence (#783)', () => {
  const metadata: registry.MacroMetadata = {
    name: 'label',
    source: 'user',
    block: false,
    subMacros: [],
    parameters: [{ name: 'value', type: 'text', holds: 'text' }],
  };
  vi.spyOn(registry, 'getMacroRegistry').mockImplementation(() => [metadata]);
  const nodes: ASTNode[] = [
    { type: 'macro', name: 'label', rawArgs: '"{@children}"', children: [] },
  ];
  expect(astContainsChildren(nodes)).toBe(false);
  metadata.parameters = [{ name: 'value', type: 'text', holds: 'markup' }];
  expect(astContainsChildren(nodes)).toBe(true);
  // A user-defined option without parameters must not regain the built-in's
  // markup-bearing option label parameters.
  metadata.name = 'option';
  delete metadata.parameters;
  nodes[0] = {
    type: 'macro',
    name: 'option',
    rawArgs: '"{@children}"',
    children: [],
  };
  expect(astContainsChildren(nodes)).toBe(false);
});
