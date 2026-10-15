import { describe, expect, it } from 'vitest';
import { defineMacro } from '../../src/define-macro';
import { getMacroRegistry, isSubMacro } from '../../src/registry';
import { parseMarkup, tokenizeMarkup } from '../../src/markup/parse';
import type { MacroNode } from '../../src/markup/ast';
import { pairMarkup } from '../../src/markup/pair';
import { validateStoryMarkup } from '../../src/tooling';

describe('custom companion macros (#564, #571)', () => {
  it('builds declared tab branches, keeping parent content separate', () => {
    defineMacro({ name: 'tabs564', subMacros: ['tab564'], render: () => null });
    const [node] = parseMarkup(
      '{tabs564}Intro{#first TAB564 Inventory}Items{tab564 Stats}Health{/tabs564}',
    ) as MacroNode[];
    expect(node!.children).toEqual([{ type: 'text', value: 'Intro' }]);
    expect(node!.branches).toEqual([
      {
        rawArgs: 'Inventory',
        id: 'first',
        children: [{ type: 'text', value: 'Items' }],
      },
      { rawArgs: 'Stats', children: [{ type: 'text', value: 'Health' }] },
    ]);
  });

  it('keeps selectors on the custom parent when it has branches', () => {
    defineMacro({
      name: 'selectorTabs564',
      subMacros: ['selectorTab564'],
      render: () => null,
    });
    const [parent] = parseMarkup(
      '{#owner.styled selectorTabs564}{selectorTab564 One}Text{/selectorTabs564}',
    ) as MacroNode[];
    expect(parent).toMatchObject({ id: 'owner', className: 'styled' });
    expect(parent!.branches).toHaveLength(1);
  });

  it('keeps nested branches with their immediate owner', () => {
    defineMacro({
      name: 'nested564',
      subMacros: ['tabNested564'],
      render: () => null,
    });
    const [outer] = parseMarkup(
      '{nested564}{tabNested564 Outer}{nested564}{tabNested564 Inner}Inside{/nested564}Outside{/nested564}',
    ) as MacroNode[];
    expect(outer!.branches).toHaveLength(1);
    const inner = outer!.branches![0]!.children[0] as MacroNode;
    expect(inner.branches![0]!.children).toEqual([
      { type: 'text', value: 'Inside' },
    ]);
    expect(outer!.branches![0]!.children[1]).toEqual({
      type: 'text',
      value: 'Outside',
    });
    expect(() =>
      parseMarkup('{nested564}<div>{tabNested564 Wrong}</div>{/nested564}'),
    ).toThrow(/must be directly inside/);
  });

  it('uses supplied tooling companion metadata without runtime registration', () => {
    const content = '{toolTabs564}{toolTab564 One}Text{/toolTabs564}';
    const metadata = [
      { name: 'toolTabs564', block: true, subMacros: ['toolTab564'] },
    ];
    expect(
      validateStoryMarkup(
        [{ name: 'Start', content }],
        [...getMacroRegistry(), ...metadata],
      ),
    ).toEqual([]);
    const paired = pairMarkup(tokenizeMarkup(content), {
      isBlock: (name) => name === 'tooltabs564',
      branchParents: (name) =>
        name.toLowerCase() === 'tooltab564' ? ['tooltabs564'] : [],
    });
    expect(paired.errors).toEqual([]);
    expect(paired.nodes[0]!.body!.branches).toHaveLength(1);
    expect(
      validateStoryMarkup(
        [
          {
            name: 'Start',
            content: '{toolTabs564}<div>{toolTab564 One}</div>{/toolTabs564}',
          },
        ],
        [...getMacroRegistry(), ...metadata],
      ).some((error) => error.code === 'misplaced-branch'),
    ).toBe(true);
  });

  it('releases removed companions only after their last owner changes', () => {
    defineMacro({
      name: 'parent571',
      subMacros: ['child571'],
      render: () => null,
    });
    defineMacro({
      name: 'other571',
      subMacros: ['CHILD571'],
      render: () => null,
    });
    defineMacro({ name: 'PARENT571', subMacros: [], render: () => null });
    expect(isSubMacro('child571')).toBe(true);
    defineMacro({ name: 'other571', render: () => null });
    defineMacro({ name: 'child571', render: () => 'Visible child' });
    expect(isSubMacro('CHILD571')).toBe(false);
    expect(parseMarkup('{child571}')).toEqual([
      { type: 'macro', name: 'child571', rawArgs: '', children: [] },
    ]);
  });
});
