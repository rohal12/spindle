import { describe, expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  parseBoundVariable,
  variableReferences,
  validateVariableReferences,
  type ToolingMacro,
} from '../../src/tooling';

const macros = getMacroRegistry();

describe('runtime input binding references (#654)', () => {
  it.each([
    ['x', 'x', [], false, 'x'],
    ['"x"', 'x', [], false, 'x'],
    ["'x'", 'x', [], false, 'x'],
    ['$x', 'x', [], true, 'x'],
    ['"$x"', 'x', [], true, 'x'],
    [String.raw`"$\u0078"`, 'x', [], true, String.raw`\u0078`],
    [String.raw`$\u{78}.na\u006de`, 'x', ['name'], true, String.raw`\u{78}`],
    [String.raw`"x.na\u006de"`, 'x', ['name'], false, 'x'],
    [String.raw`'$x.\u0024foo.\u00e9'`, 'x', ['$foo', 'é'], true, 'x'],
  ] as const)(
    'reports decoded identity and editable spans for %s',
    (term, name, path, explicitSigil, root) => {
      const rawArgs = ` \n ${term} "Placeholder"`;
      const binding = parseBoundVariable(rawArgs)!;
      expect(binding).toMatchObject({ name, path, explicitSigil });
      expect(rawArgs.slice(binding.nameStart, binding.nameEnd)).toBe(root);
      expect(rawArgs.slice(binding.start, binding.end)).toBe(
        term.replace(/["']/g, ''),
      );
      const source = `😀 {textbox${rawArgs}}`;
      const refs = variableReferences(source, macros, { all: true });
      expect(refs).toHaveLength(1);
      const ref = refs[0]!;
      expect(ref).toMatchObject({ sigil: '$', name, path });
      expect(ref.binding).toEqual({
        ...binding,
        start: binding.start + '😀 {textbox'.length,
        end: binding.end + '😀 {textbox'.length,
        nameStart: binding.nameStart + '😀 {textbox'.length,
        nameEnd: binding.nameEnd + '😀 {textbox'.length,
      });
      expect(source.slice(ref.start, ref.end)).toBe(
        rawArgs.slice(binding.start, binding.end),
      );
    },
  );

  it.each(macros.filter((macro) => macro.storeVar).map((macro) => macro.name))(
    'includes sigilless bindings of %s',
    (name) => {
      const source = `{${name.toUpperCase()} "x"}`;
      expect(variableReferences(source, macros, { all: true })).toMatchObject([
        { name: 'x', binding: { explicitSigil: false } },
      ]);
    },
  );

  it('keeps sigilless bindings out of startup validation', () => {
    const content = '{textbox "x"}{textbox x}';
    expect(variableReferences(content, macros)).toEqual([]);
    expect(
      validateVariableReferences(
        [{ name: 'Start', content }],
        { variables: new Map() },
        macros,
      ),
    ).toEqual([]);
    expect(variableReferences(content, macros, { all: true })).toHaveLength(2);
  });

  it('validates escaped explicit bindings by their decoded identity', () => {
    const content = String.raw`{textbox "$\u0078.na\u006de"}`;
    const diagnostics = validateVariableReferences(
      [{ name: 'Start', content }],
      { variables: new Map() },
      macros,
    );
    expect(diagnostics).toMatchObject([
      { name: 'x', path: ['name'], code: 'undeclared-variable' },
    ]);
    expect(content.slice(diagnostics[0]!.start, diagnostics[0]!.end)).toBe(
      String.raw`$\u0078.na\u006de`,
    );
  });

  it('collects parameterless custom bindings once, with the decoded path', () => {
    const custom: ToolingMacro = {
      name: 'custom',
      block: false,
      subMacros: [],
      storeVar: true,
    };
    const source = String.raw`{custom $\u0078.na\u006de $other}`;
    expect(variableReferences(source, [custom], { all: true })).toMatchObject([
      { name: 'x', path: ['name'], binding: { explicitSigil: true } },
      { name: 'other' },
    ]);
  });

  it('honors macro replacements and widgets that shadow input macros', () => {
    const source = '{textbox "x"}';
    for (const replacement of [
      {
        parameters: [
          { name: 'label', type: 'text' as const, holds: 'text' as const },
        ],
      },
      { widget: { params: ['@label'] } },
    ]) {
      expect(
        variableReferences(
          source,
          [
            ...macros,
            { name: 'TEXTBOX', block: false, subMacros: [], ...replacement },
          ],
          { all: true },
        ),
      ).toEqual([]);
    }
  });

  it.each([
    '"%x"',
    '"_x"',
    '"@x"',
    String.raw`"\u0078"`,
    String.raw`"$\x78"`,
    String.raw`"$\\u0078"`,
    String.raw`"$\u0024x"`,
    String.raw`"$x.\u005f_proto__"`,
  ])(
    'shares runtime rejection of %s without treating it as a string',
    (term) => {
      expect(() => parseBoundVariable(term)).toThrow();
      expect(
        variableReferences(`{textbox ${term}}`, macros, { all: true }),
      ).toEqual([]);
    },
  );

  it('has no binding for missing arguments', () => {
    expect(parseBoundVariable(' \n ')).toBeNull();
    expect(variableReferences('{textbox}', macros, { all: true })).toEqual([]);
  });

  it('keeps bindings and other references in source order', () => {
    const source = String.raw`{.{$cls} textbox "x.na\u006de"} {print $label} {$last}`;
    const refs = variableReferences(source, macros, { all: true });
    expect(refs.map((ref) => ref.name)).toEqual(['cls', 'x', 'label', 'last']);
    expect(refs.map((ref) => ref.start)).toEqual(
      [...refs.map((ref) => ref.start)].sort((a, b) => a - b),
    );
  });
});
