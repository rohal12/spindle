import { expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import { macroCallAt, macroCalls, type ToolingMacro } from '../../src/tooling';

const macros: ToolingMacro[] = [
  ...getMacroRegistry(),
  {
    name: 'option',
    block: false,
    subMacros: [],
    widget: { params: ['@widgetOnly'], holds: { '@widgetOnly': 'markup' } },
  },
];

it.each(['cycle', 'listbox'])(
  'attributes unfinished %s values to their control (#707)',
  (name) => {
    const standalone = '{option "A';
    expect(macroCallAt(standalone, standalone.length, macros)).toMatchObject({
      kind: 'invocation',
      token: { name: 'option', rawArgs: '"A' },
    });
    const source = `{${name} "$x"}{option "A`;
    const call = macroCallAt(source, source.length, macros);
    expect(call).toMatchObject({
      kind: 'value',
      token: { name: 'option', rawArgs: '"A', end: source.length },
      owner: { name },
    });
    const complete = source + `"}{/${name}}`;
    expect(macroCallAt(complete, source.length, macros)).toEqual(
      macroCalls(complete, macros)[1],
    );
  },
);

it.each([
  '{cycle "$x"}{button "label"}{option "A',
  '{cycle "$x"}{button "{option \\"A',
  '<span title=\'{cycle "$x"}{option "A',
  '{cycle "$x"}<span title=\'{option "A',
  '{cycle "$x"}[[{option "A',
])('preserves the innermost markup ownership in %s (#707)', (source) => {
  const call = macroCallAt(source, source.length, macros);
  expect(call).toMatchObject({
    kind: source.includes("title='{cycle") ? 'value' : 'invocation',
    token: { name: 'option' },
  });
  expect(source.slice(call!.token.nameStart, call!.token.nameEnd)).toBe(
    'option',
  );
});

it('uses effective replacement metadata for unfinished calls (#707)', () => {
  const source = '{cycle "$x"}{option "A';
  expect(
    macroCallAt(source, source.length, [
      ...macros,
      { name: 'cycle', block: true, subMacros: [], widget: { params: [] } },
    ]),
  ).toMatchObject({ kind: 'invocation' });
  expect(macroCallAt('prose', 3, macros)).toBeUndefined();
  expect(() => macroCallAt('', -1, macros)).toThrow(RangeError);
});

it('classifies incomplete heads inside completed encoded labels (#707)', () => {
  const source = String.raw`{cycle "$x"}{button "{option \"A"}body{/button}{/cycle}`;
  const cursor = source.indexOf('A') + 1;
  expect(macroCallAt(source, cursor, macros)).toMatchObject({
    kind: 'invocation',
    token: { name: 'option' },
  });
});

it('classifies unfinished branches with their effective owner (#707)', () => {
  const source = '{panel}{part "A';
  expect(
    macroCallAt(source, source.length, [
      ...macros,
      { name: 'panel', block: true, subMacros: ['part'] },
    ]),
  ).toMatchObject({ kind: 'branch', owner: { name: 'panel' } });
});
