import { expect, it } from 'vitest';
import { branchParents, getMacroRegistry } from '../../src/registry';
import {
  tokenizeMarkup,
  tokenizeMarkupTolerant,
  completionContext,
  discoverMacros,
  passagePieces,
  validateStoryMarkup,
  variableReferences,
  type ToolingMacro,
} from '../../src/tooling';

const builtins = getMacroRegistry();

it.each(['listbox', 'cycle'])(
  'retains option value markers when %s is replaced (#665)',
  (name) => {
    const other = name === 'listbox' ? 'cycle' : 'listbox';
    const macros = [
      ...builtins,
      ...discoverMacros(
        `Story.defineMacro({name:'${name}', block:true, render(){}});`,
      ),
    ];
    expect(
      validateStoryMarkup(
        [
          {
            name: 'Start',
            content: `{${other} $x}{option "a"}{option "b"}{/${other}}`,
          },
        ],
        macros,
      ),
    ).toEqual([]);
    expect(branchParents('option', macros)).toEqual([]);
  },
);

it('discards omitted parameters on a macro replacement (#647)', () => {
  const macros = [
    ...builtins,
    ...discoverMacros('Story.defineMacro({name:"PRINT", render(){}});'),
  ];
  const source = '{print hello world}';
  expect(passagePieces(source, macros)).toEqual([]);
  expect(
    validateStoryMarkup([{ name: 'Start', content: source }], macros),
  ).toEqual([]);
  expect(
    completionContext('{print $obj.', '{print $obj.'.length, macros),
  ).toEqual({ kind: 'literal' });
});

it('discards obsolete storeVar bindings, including case variants (#647)', () => {
  const replacement: ToolingMacro = {
    name: 'TEXTBOX',
    block: false,
    subMacros: [],
    parameters: [{ name: 'label', type: 'text', holds: 'text' }],
  };
  expect(
    variableReferences('{textbox "$missing"}', [...builtins, replacement]),
  ).toEqual([]);
  expect(
    variableReferences('{textbox "$actual"}', [replacement, ...builtins]),
  ).toMatchObject([{ name: 'actual' }]);
});

it.each(['if', 'elseif', 'case'])(
  'honors replacement %s text parameters in validation and completion (#648)',
  (name) => {
    const replacement: ToolingMacro = {
      name,
      block: name === 'if',
      subMacros: [],
      source: 'user',
      parameters: [{ name: 'label', type: 'text', holds: 'text' }],
    };
    // Omit the old entry to isolate provenance from stale metadata.
    const macros = [...builtins.filter((m) => m.name !== name), replacement];
    expect(
      passagePieces(`{${name} Hello world}`, macros).filter(
        (p) => p.kind === 'code',
      ),
    ).toEqual([]);
    const source = `{${name} $obj.`;
    expect(completionContext(source, source.length, macros)).toEqual({
      kind: 'literal',
    });
    if (name === 'if')
      expect(
        validateStoryMarkup(
          [{ name: 'Start', content: '{if Hello world}ignored{/if}' }],
          macros,
        ),
      ).toEqual([]);
  },
);

it('does not interpret replacement dialog bodies as passage names (#648)', () => {
  const macros: ToolingMacro[] = [
    ...builtins.filter((m) => m.name !== 'dialog'),
    { name: 'dialog', block: true, subMacros: [] },
  ];
  const source = '{dialog "Caption"}ordinary text{/dialog}';
  expect(passagePieces(source, macros)).toEqual([]);
  expect(
    validateStoryMarkup([{ name: 'Start', content: source }], macros),
  ).toEqual([]);
});

it('retains builtin conditional and dialog defaults without metadata (#648)', () => {
  expect(passagePieces('{if $ok}yes{/if}', [])).toMatchObject([
    { kind: 'code', code: '$ok' },
  ]);
  expect(passagePieces('{dialog "Open"}Target{/dialog}', [])).toMatchObject([
    { kind: 'passage', name: 'Target' },
  ]);
});

it('discards superseded blocks and companion requirements in any case (#660)', () => {
  const macros = discoverMacros(`
    Story.defineMacro({name:'panel', block:true, subMacros:['part'], render(){}});
    Story.defineMacro({name:'PANEL', block:false, subMacros:[], render(){}});
    Story.defineMacro({name:'part', render(){}});
  `);
  expect(
    validateStoryMarkup([{ name: 'Start', content: '{panel}{part}' }], macros),
  ).toEqual([]);
  expect(
    validateStoryMarkup(
      [{ name: 'Start', content: '{part}' }],
      macros.slice(0, -1),
    ),
  ).toMatchObject([{ code: 'unknown-macro' }]);
  expect(branchParents('part', macros)).toEqual([]);
  expect(tokenizeMarkup('{panel}', { macros })).toMatchObject([
    { name: 'panel' },
  ]);
  expect(tokenizeMarkupTolerant('{panel}', { macros }).errors).toEqual([]);
  // Reversing precedence restores the original parent and companion.
  const restored = [...macros, macros[0]!];
  expect(
    validateStoryMarkup([{ name: 'Start', content: '{panel}' }], restored),
  ).toMatchObject([{ code: 'unclosed-block' }]);
  expect(branchParents('part', restored)).toEqual(['panel']);
});
