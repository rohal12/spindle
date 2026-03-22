import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerMacroMetadata,
  getMacroRegistry,
  clearMetadataRegistry,
} from '../../src/registry';
import type { MacroMetadata } from '../../src/registry';
import { defineMacro } from '../../src/define-macro';

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
        { name: 'target', required: true, description: 'The target variable' },
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
      parameters: [{ name: 'value', required: true, description: 'The value' }],
      render: () => null,
    });
    const meta = getMacroRegistry().find((m) => m.name === 'test-docs');
    expect(meta!.description).toBe('A documented macro');
    expect(meta!.parameters).toEqual([
      { name: 'value', required: true, description: 'The value' },
    ]);
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
