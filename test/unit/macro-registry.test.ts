import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import {
  registerMacroMetadata,
  getMacroRegistry,
  clearMetadataRegistry,
} from '../../src/registry';
import type { MacroMetadata } from '../../src/registry';
import { defineMacro } from '../../src/define-macro';

// Capture the initial builtin registry snapshot before any test clears it.
// setupFiles has already registered all builtins by the time this module runs.
const builtinSnapshot: MacroMetadata[] = getMacroRegistry().map((m) => ({
  ...m,
}));

describe('macro metadata registry', () => {
  beforeEach(() => {
    clearMetadataRegistry();
  });

  it('stores and retrieves metadata', () => {
    const meta: MacroMetadata = {
      name: 'test',
      block: false,
      subMacros: [],
      source: 'builtin',
    };
    registerMacroMetadata('test', meta);
    const all = getMacroRegistry();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(meta);
  });

  it('normalizes name to lowercase', () => {
    registerMacroMetadata('MyMacro', {
      name: 'MyMacro',
      block: false,
      subMacros: [],
      source: 'builtin',
    });
    const all = getMacroRegistry();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe('MyMacro');
  });

  it('overwrites metadata for the same name', () => {
    registerMacroMetadata('test', {
      name: 'test',
      block: false,
      subMacros: [],
      source: 'builtin',
    });
    registerMacroMetadata('test', {
      name: 'test',
      block: true,
      subMacros: ['child'],
      source: 'user',
    });
    const all = getMacroRegistry();
    expect(all).toHaveLength(1);
    expect(all[0]!.block).toBe(true);
    expect(all[0]!.source).toBe('user');
  });

  it('includes optional fields when present', () => {
    registerMacroMetadata('rich', {
      name: 'rich',
      block: true,
      subMacros: ['sub1'],
      storeVar: true,
      interpolate: true,
      merged: true,
      description: 'A rich macro',
      parameters: [
        {
          name: 'target',
          type: 'variable',
          required: true,
          description: 'The target variable',
        },
      ],
      source: 'user',
    });
    const meta = getMacroRegistry()[0]!;
    expect(meta.storeVar).toBe(true);
    expect(meta.interpolate).toBe(true);
    expect(meta.merged).toBe(true);
    expect(meta.description).toBe('A rich macro');
    expect(meta.parameters).toHaveLength(1);
    expect(meta.parameters![0]!.name).toBe('target');
  });

  it('clearMetadataRegistry empties the registry', () => {
    registerMacroMetadata('a', {
      name: 'a',
      block: false,
      subMacros: [],
      source: 'builtin',
    });
    registerMacroMetadata('b', {
      name: 'b',
      block: false,
      subMacros: [],
      source: 'builtin',
    });
    expect(getMacroRegistry()).toHaveLength(2);
    clearMetadataRegistry();
    expect(getMacroRegistry()).toHaveLength(0);
  });
});

describe('defineMacro stores metadata', () => {
  beforeEach(() => {
    clearMetadataRegistry();
  });

  it('stores basic metadata from defineMacro config', () => {
    defineMacro({
      name: 'test-basic',
      render: () => null,
    });
    const all = getMacroRegistry();
    const meta = all.find((m) => m.name === 'test-basic');
    expect(meta).toBeDefined();
    expect(meta!.block).toBe(false);
    expect(meta!.subMacros).toEqual([]);
    expect(meta!.source).toBe('builtin');
  });

  it('stores feature flags from config', () => {
    defineMacro({
      name: 'test-flags',
      block: true,
      subMacros: ['child-a', 'child-b'],
      interpolate: true,
      merged: true,
      storeVar: true,
      render: () => null,
    });
    const meta = getMacroRegistry().find((m) => m.name === 'test-flags');
    expect(meta).toBeDefined();
    expect(meta!.block).toBe(true);
    expect(meta!.subMacros).toEqual(['child-a', 'child-b']);
    expect(meta!.interpolate).toBe(true);
    expect(meta!.merged).toBe(true);
    expect(meta!.storeVar).toBe(true);
  });

  it('stores description and parameters', () => {
    defineMacro({
      name: 'test-docs',
      description: 'A documented macro',
      parameters: [
        {
          name: 'value',
          type: 'expression',
          required: true,
          description: 'The value',
        },
      ],
      render: () => null,
    });
    const meta = getMacroRegistry().find((m) => m.name === 'test-docs');
    expect(meta!.description).toBe('A documented macro');
    expect(meta!.parameters).toEqual([
      {
        name: 'value',
        type: 'expression',
        required: true,
        description: 'The value',
      },
    ]);
  });

  it('throws for a declared parameter without a type', () => {
    expect(() =>
      defineMacro({
        name: 'untyped',
        // @ts-expect-error: the type is required
        parameters: [{ name: 'amount', required: true }],
        render: () => null,
      }),
    ).toThrow(
      'spindle: The parameter "amount" of the macro {untyped} has no type. ' +
        'Give it one of the types expression, statements, passage, variable, ' +
        'string, text, names, delay, number, flag, separator, options ' +
        '(see docs/custom-macros.md#parameter-types), ' +
        'or declare no parameters and read props.rawArgs.',
    );
    // Nothing is registered
    expect(getMacroRegistry().find((m) => m.name === 'untyped')).toBe(
      undefined,
    );
  });

  it('throws for an option without a type, or an unknown type', () => {
    expect(() =>
      defineMacro({
        name: 'opts',
        parameters: [
          {
            name: 'options',
            type: 'options',
            // @ts-expect-error: the type is required
            parameters: [{ name: 'once' }],
          },
        ],
        render: () => null,
      }),
    ).toThrow('The parameter "once" of the macro {opts} has no type.');
    expect(() =>
      defineMacro({
        name: 'typo',
        // @ts-expect-error: not a parameter type
        parameters: [{ name: 'amount', type: 'expresion' }],
        render: () => null,
      }),
    ).toThrow(
      'The parameter "amount" of the macro {typo} has the unknown type "expresion".',
    );
  });

  it('accepts a macro that declares no parameters, which reads rawArgs', () => {
    expect(() =>
      defineMacro({ name: 'raw', render: (props) => props.rawArgs }),
    ).not.toThrow();
  });

  it('defaults source to builtin', () => {
    defineMacro({ name: 'test-src', render: () => null });
    const meta = getMacroRegistry().find((m) => m.name === 'test-src');
    expect(meta!.source).toBe('builtin');
  });

  it('accepts explicit source parameter', () => {
    defineMacro({ name: 'test-user', render: () => null }, 'user');
    const meta = getMacroRegistry().find((m) => m.name === 'test-user');
    expect(meta!.source).toBe('user');
  });
});

describe('builtin macros have metadata', () => {
  // NOTE: do NOT call clearMetadataRegistry() here — we want builtins.
  // Restore from the snapshot captured at module load time (before any
  // beforeEach in the earlier describe blocks cleared the registry).
  beforeAll(() => {
    clearMetadataRegistry();
    for (const meta of builtinSnapshot) {
      registerMacroMetadata(meta.name, meta);
    }
  });

  it('all expected builtins are present', () => {
    const registry = getMacroRegistry();
    const names = registry.map((m) => m.name);
    expect(names).toContain('set');
    expect(names).toContain('if');
    expect(names).toContain('for');
    expect(names).toContain('button');
    expect(names).toContain('switch');
    expect(names).toContain('textbox');
    expect(names).toContain('widget');
  });

  it('block macros are marked as block', () => {
    const registry = getMacroRegistry();
    const ifMacro = registry.find((m) => m.name === 'if');
    expect(ifMacro!.block).toBe(true);
    const forMacro = registry.find((m) => m.name === 'for');
    expect(forMacro!.block).toBe(true);
  });

  it('non-block macros are not marked as block', () => {
    const registry = getMacroRegistry();
    const setMacro = registry.find((m) => m.name === 'set');
    expect(setMacro!.block).toBe(false);
  });

  it('switch has correct subMacros', () => {
    const registry = getMacroRegistry();
    const switchMacro = registry.find((m) => m.name === 'switch');
    expect(switchMacro!.subMacros).toEqual(['case', 'default']);
  });

  it('all builtins have source builtin', () => {
    const registry = getMacroRegistry();
    const builtinNames = [
      'set',
      'if',
      'for',
      'button',
      'switch',
      'textbox',
      'widget',
    ];
    for (const name of builtinNames) {
      const macro = registry.find((m) => m.name === name);
      expect(macro!.source, `${name} should have source 'builtin'`).toBe(
        'builtin',
      );
    }
  });

  it('feature flags are preserved', () => {
    const registry = getMacroRegistry();
    const ifMacro = registry.find((m) => m.name === 'if');
    expect(ifMacro!.interpolate).toBe(true);
    expect(ifMacro!.merged).toBe(true);

    const textboxMacro = registry.find((m) => m.name === 'textbox');
    expect(textboxMacro!.storeVar).toBe(true);
  });
});
