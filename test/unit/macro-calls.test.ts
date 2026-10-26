import { expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import { macroCalls, type ToolingMacro } from '../../src/tooling';
import { registerBlockMacro, unregisterBlockMacro } from '../../src/markup/ast';

const builtins = getMacroRegistry();
const optionWidget: ToolingMacro = {
  name: 'OPTION',
  block: false,
  subMacros: [],
  widget: { params: ['@value'], holds: { '@value': 'markup' } },
};

it('classifies explicit metadata independently of runtime registrations (#680)', () => {
  const source = '{listbox $x}{inline680}{option "A"}{/listbox}';
  const macros = [
    ...builtins,
    { name: 'inline680', block: false, subMacros: [] },
  ];
  const kinds = () => macroCalls(source, macros).map(({ kind }) => kind);
  expect(kinds()).toEqual(['invocation', 'invocation', 'value']);
  registerBlockMacro('inline680');
  try {
    expect(kinds()).toEqual(['invocation', 'invocation', 'value']);
  } finally {
    unregisterBlockMacro('inline680');
  }
});

it.each(['listbox', 'cycle'])(
  'classifies direct %s values independently of widget dispatch (#680)',
  (parent) => {
    const source = `😀 {option "standalone"}{${parent} $x}{OpTiOn "A"}{option "B"}{/${parent}}`;
    const calls = macroCalls(source, [...builtins, optionWidget]);
    expect(
      calls.map(({ token, kind, owner }) => [
        token.name.toLowerCase(),
        kind,
        owner?.name,
      ]),
    ).toEqual([
      ['option', 'invocation', undefined],
      [parent, 'invocation', undefined],
      ['option', 'value', parent],
      ['option', 'value', parent],
    ]);
    for (const { token, owner } of calls) {
      expect(source.slice(token.nameStart, token.nameEnd)).toBe(token.name);
      expect(source.slice(token.start, token.end)).toContain(token.name);
      if (owner)
        expect(source.slice(owner.start, owner.end)).toBe(`{${parent} $x}`);
    }
  },
);

it('keeps nesting and evaluated labels and attributes in separate ownership scopes (#680)', () => {
  const source = `{listbox $x}<span title='{option "attribute"}'>{option "nested"}</span>{button '{option "label"}'}{option "body"}{/button}{option "value"}{/listbox} [[{option "link"}->Hall]]`;
  const calls = macroCalls(source, [...builtins, optionWidget]);
  expect(
    calls
      .filter(({ token }) => token.name.toLowerCase() === 'option')
      .map(({ token, kind }) => [token.rawArgs, kind]),
  ).toEqual([
    ['"attribute"', 'invocation'],
    ['"nested"', 'invocation'],
    ['"label"', 'invocation'],
    ['"body"', 'invocation'],
    ['"value"', 'value'],
    ['"link"', 'invocation'],
  ]);
  for (const { token } of calls)
    expect(source.slice(token.nameStart, token.nameEnd)).toBe(token.name);
});

it.each(['listbox', 'cycle'])(
  'drops builtin ownership for a replacement %s macro or widget (#680)',
  (name) => {
    const source = `{${name}}{option "call"}{/${name}}`;
    for (const widget of [undefined, { params: [] }]) {
      const replacement: ToolingMacro = {
        name: name.toUpperCase(),
        block: true,
        subMacros: [],
        widget,
      };
      const macros = widget
        ? [replacement, ...builtins, optionWidget]
        : [...builtins, replacement, optionWidget];
      expect(macroCalls(source, macros).map(({ kind }) => kind)).toEqual([
        'invocation',
        'invocation',
      ]);
    }
    // No process-global registration or metadata leaks between calls.
    expect(macroCalls(source, builtins)[1]?.kind).toBe('value');
  },
);

it('distinguishes declared custom branches from ordinary child invocations (#680, #682)', () => {
  const macros = [
    ...builtins,
    optionWidget,
    { name: 'panel', block: true, subMacros: ['part', 'else'] },
  ];
  const source = '{panel}{option "call"}{part}Body{ELSE}Other{/panel}';
  expect(
    macroCalls(source, macros).map(({ token, kind, owner }) => [
      token.name,
      kind,
      owner?.name,
    ]),
  ).toEqual([
    ['panel', 'invocation', undefined],
    ['option', 'invocation', undefined],
    ['part', 'branch', 'panel'],
    ['ELSE', 'branch', 'panel'],
  ]);
  expect(macroCalls('{else}', builtins)).toMatchObject([{ kind: 'branch' }]);
  expect(macroCalls('{else}', builtins)[0]?.owner).toBeUndefined();
});

it('uses branch semantics for custom replacements declaring option companions (#680)', () => {
  const replacement = { name: 'listbox', block: true, subMacros: ['option'] };
  expect(
    macroCalls('{listbox}{option "branch"}Body{/listbox}', [
      ...builtins,
      replacement,
    ]),
  ).toMatchObject([
    { kind: 'invocation' },
    { kind: 'branch', owner: { name: 'listbox' } },
  ]);
});

it('maps escaped nested heads back to their original name spans (#680)', () => {
  const source = String.raw`😀 {button 'prefix\\ \"quoted\" {option \"escaped\"}'}Body{/button}`;
  const call = macroCalls(source, [...builtins, optionWidget]).find(
    ({ token }) => token.name !== 'button',
  )!;
  expect(call.kind).toBe('invocation');
  expect(call.token.name).toBe('option');
  expect(source.slice(call.token.nameStart, call.token.nameEnd)).toBe('option');
  expect(call.token.nameStart).toBe(source.indexOf('option'));
});

it('keeps parent-consumed values literal despite widget markup parameters (#680)', () => {
  const source = `{listbox $x}{option '{option "literal"}'}{/listbox} {option '{option "evaluated"}'}`;
  expect(
    macroCalls(source, [...builtins, optionWidget]).map(({ token, kind }) => [
      token.name,
      kind,
    ]),
  ).toEqual([
    ['listbox', 'invocation'],
    ['option', 'value'],
    ['option', 'invocation'],
    ['option', 'invocation'],
  ]);
});
