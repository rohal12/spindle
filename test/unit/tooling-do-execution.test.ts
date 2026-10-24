import { expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  completionContext,
  passagePieces,
  validateStoryMarkup,
  variableReferences,
} from '../../src/tooling';

const builtins = getMacroRegistry();
const source =
  '{do}$ghost = 1; Story.defineMacro({name:"textbox",render(){}});{/do}';

it.each([undefined, 'user'] as const)(
  'does not classify replaced do bodies as executed (source: %s) (#644)',
  (origin) => {
    const macros = [
      ...builtins.filter((macro) => macro.name !== 'do'),
      {
        name: 'DO',
        block: true,
        subMacros: [],
        ...(origin && { source: origin }),
      },
    ];
    expect(passagePieces(source, macros)).toEqual([]);
    expect(variableReferences(source, macros)).toEqual([]);
    const partial = '{do}$obj.';
    expect(completionContext(partial, partial.length, macros)).toEqual({
      kind: 'literal',
    });
    expect(
      validateStoryMarkup(
        [{ name: 'Start', content: '{do}not valid JavaScript !!{/do}' }],
        macros,
      ),
    ).toEqual([]);
  },
);

it('keeps builtin do execution and implicit builtin defaults (#644)', () => {
  for (const macros of [builtins, []]) {
    expect(passagePieces(source, macros)).toMatchObject([
      {
        kind: 'code',
        goal: 'statements',
        code: '$ghost = 1; Story.defineMacro({name:"textbox",render(){}});',
      },
    ]);
    expect(variableReferences(source, macros)).toMatchObject([
      { name: 'ghost' },
    ]);
  }
});

it('keeps forwarded widget markup executable after replacing do (#644)', () => {
  const macros = [
    ...builtins,
    { name: 'do', block: true, subMacros: [], widget: { params: [] } },
  ];
  expect(passagePieces('{do}{print $actual}{/do}', macros)).toMatchObject([
    { kind: 'code', goal: 'expression', code: '$actual' },
  ]);
  expect(variableReferences('{do}{print $actual}{/do}', macros)).toMatchObject([
    { name: 'actual' },
  ]);
});
