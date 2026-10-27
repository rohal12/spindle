import { describe, expect, it } from 'vitest';
import { defineMacro } from '../../src/define-macro';
import { getMacroRegistry, isSubMacro } from '../../src/registry';
import { parseMarkup, tokenizeMarkup } from '../../src/markup/parse';
import type { MacroNode } from '../../src/markup/ast';
import { pairMarkup } from '../../src/markup/pair';
import {
  completionContext,
  macroCalls,
  passagePieces,
  validateStoryMarkup,
  variableReferences,
} from '../../src/tooling';

describe('custom companion macros (#564, #571)', () => {
  it.each(['case', 'elseif', 'option'])(
    'ignores standalone %s parameters when a custom parent consumes the branch',
    (name) => {
      const parent = {
        name: 'rawBranchPanel682',
        block: true,
        subMacros: [name],
      };
      const macros = [
        ...getMacroRegistry(),
        parent,
        {
          name,
          block: false,
          subMacros: [],
          parameters: [
            { name: 'value', type: 'expression' as const, required: true },
          ],
        },
      ];
      const source = `{rawBranchPanel682}{${name} Hello world}{/rawBranchPanel682}`;
      expect(
        validateStoryMarkup([{ name: 'Start', content: source }], macros),
      ).toEqual([]);
      expect(passagePieces(source, macros)).toEqual([]);
      const prefix = `{rawBranchPanel682}{${name} $value`;
      expect(
        variableReferences(`${prefix}}{/rawBranchPanel682}`, macros),
      ).toEqual([]);
      expect(completionContext(prefix, prefix.length, macros)).toEqual({
        kind: 'literal',
      });
      const widgetMacros = [
        ...getMacroRegistry(),
        parent,
        {
          name,
          block: false,
          subMacros: [],
          widget: {
            params: ['@label'],
            holds: { '@label': 'markup' as const },
          },
        },
      ];
      const widgetSource = `{rawBranchPanel682}{${name} '{ghost682}'}{/rawBranchPanel682}`;
      expect(
        macroCalls(widgetSource, widgetMacros).map(({ token }) => token.name),
      ).toEqual(['rawBranchPanel682', name]);
      expect(passagePieces(widgetSource, widgetMacros)).toEqual([]);
      const builtinParent =
        name === 'case' ? 'switch' : name === 'elseif' ? 'if' : undefined;
      if (builtinParent) {
        const builtin = `{${builtinParent} true}{${name} Hello world}{/${builtinParent}}`;
        expect(
          validateStoryMarkup([{ name: 'Start', content: builtin }], macros),
        ).toMatchObject([{ code: 'code-syntax' }]);
      }
    },
  );

  it.each(['case', 'elseif'])(
    'keeps custom %s arguments opaque while checking builtin conditions (#682)',
    (companion) => {
      const macros = [
        ...getMacroRegistry(),
        { name: 'labelPanel682', block: true, subMacros: [companion] },
      ];
      const source = `{labelPanel682}Intro{${companion} Hello world}Other{/labelPanel682}`;
      expect(
        validateStoryMarkup([{ name: 'Start', content: source }], macros),
      ).toEqual([]);
      expect(
        passagePieces(source, macros).filter((piece) => piece.kind === 'code'),
      ).toEqual([]);
      const prefix = `{labelPanel682}{${companion} Hello world`;
      expect(completionContext(prefix, prefix.length, macros)).toEqual({
        kind: 'literal',
      });
      const parent = companion === 'case' ? 'switch' : 'if';
      const builtin = `{${parent} true}{${companion} Hello world}{/${parent}}`;
      expect(
        validateStoryMarkup([{ name: 'Start', content: builtin }], macros),
      ).toMatchObject([{ code: 'code-syntax' }]);
      const nested = `{labelPanel682}{${companion} Hello world}{${parent} true}{${companion} true}{/${parent}}{/labelPanel682}`;
      expect(
        passagePieces(nested, macros)
          .filter((piece) => piece.kind === 'code')
          .map((piece) => piece.code),
      ).toEqual(['true', 'true']);
      const attribute = `<span title='${source}'></span>`;
      expect(
        validateStoryMarkup([{ name: 'Start', content: attribute }], macros),
      ).toEqual([]);
    },
  );

  it.each(['else', 'elseif', 'case', 'default', 'next'])(
    'shares builtin-named %s branches with custom parents (#682)',
    (companion) => {
      const name = `panel682${companion}`;
      defineMacro({ name, subMacros: [companion], render: () => null });
      const source = `{${name}}Intro{${companion}}Other{/${name}}`;
      const [node] = parseMarkup(source) as MacroNode[];
      expect(node!.children).toEqual([{ type: 'text', value: 'Intro' }]);
      expect(node!.branches).toMatchObject([
        { children: [{ value: 'Other' }] },
      ]);
      expect(
        validateStoryMarkup(
          [{ name: 'Start', content: source }],
          getMacroRegistry(),
        ),
      ).toEqual([]);
    },
  );

  it('treats an explicit branchParents callback as authoritative (#682)', () => {
    const source = '{panel}Intro{else}Other{/panel}';
    const paired = pairMarkup(tokenizeMarkup(source), {
      isBlock: (name) => name === 'panel',
      branchParents: (name) => (name === 'else' ? ['panel'] : []),
    });
    expect(paired.errors).toEqual([]);
    expect(paired.nodes[0]!.body!.branches[0]!.tag.name).toBe('else');
  });

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
      subMacros: ['child571', 'CHILD571'],
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
