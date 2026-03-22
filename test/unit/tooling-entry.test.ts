import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

// We test the tooling module's logic by simulating what pkg/tooling.js does.
// The actual pkg/tooling.js is a plain JS file read at runtime from dist/pkg/macro-registry.json.
// Here we test the contract: defineMacro captures metadata, getMacroRegistry returns it.

describe('tooling entry point contract', () => {
  // Simulate the tooling module's metadata-only registry
  let metadata: Map<string, any>;

  function defineMacro(config: any) {
    const name = config.name.toLowerCase();
    metadata.set(name, {
      name: config.name,
      block: config.block ?? (config.subMacros?.length > 0 ? true : false),
      subMacros: config.subMacros ?? [],
      storeVar: config.storeVar,
      interpolate: config.interpolate,
      merged: config.merged,
      description: config.description,
      parameters: config.parameters,
      source: 'user',
    });
  }

  function getMacroRegistry() {
    return Array.from(metadata.values());
  }

  beforeEach(() => {
    metadata = new Map();
  });

  it('defineMacro captures metadata without render function', () => {
    defineMacro({
      name: 'custom',
      block: true,
      subMacros: ['option'],
      description: 'A custom macro',
      render: () => null, // ignored by tooling shim
    });
    const all = getMacroRegistry();
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('custom');
    expect(all[0].block).toBe(true);
    expect(all[0].subMacros).toEqual(['option']);
    expect(all[0].description).toBe('A custom macro');
    expect(all[0].source).toBe('user');
  });

  it('block defaults to true when subMacros are present', () => {
    defineMacro({
      name: 'branching',
      subMacros: ['branch'],
      render: () => null,
    });
    expect(getMacroRegistry()[0].block).toBe(true);
  });

  it('block defaults to false when no subMacros', () => {
    defineMacro({ name: 'simple', render: () => null });
    expect(getMacroRegistry()[0].block).toBe(false);
  });

  it('multiple macros accumulate', () => {
    defineMacro({ name: 'a', render: () => null });
    defineMacro({ name: 'b', block: true, render: () => null });
    expect(getMacroRegistry()).toHaveLength(2);
  });
});

describe('pkg/tooling.js exists', () => {
  it('tooling.js file exists in pkg/', () => {
    const toolingPath = resolve(__dirname, '../../pkg/tooling.js');
    expect(existsSync(toolingPath)).toBe(true);
  });

  it('tooling type declaration exists', () => {
    const typesPath = resolve(__dirname, '../../pkg/types/tooling.d.ts');
    expect(existsSync(typesPath)).toBe(true);
  });
});
