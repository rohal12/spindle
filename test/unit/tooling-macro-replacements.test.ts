import { expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  completionContext,
  discoverMacros,
  passagePieces,
  validateStoryMarkup,
  variableReferences,
  type ToolingMacro,
} from '../../src/tooling';

const builtins = getMacroRegistry();

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
