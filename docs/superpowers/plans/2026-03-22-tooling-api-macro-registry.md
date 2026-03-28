# Tooling API: Macro Registry Metadata — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose macro registry metadata for external tooling (LSP servers, linters, CLI checkers) so they can enumerate all registered macros and their metadata without hardcoded definitions.

**Architecture:** Two access paths share the same `MacroMetadata` type. Runtime path: `Story.getMacroRegistry()` reads live metadata from a parallel Map in `src/registry.ts`, populated by `defineMacro()`. Tooling path: `@rohal12/spindle/tooling` is a lightweight Node.js module with its own metadata-only `defineMacro()` shim (no Preact dependency) that pre-loads builtin metadata from a build-time JSON snapshot. The build script generates this JSON by importing builtins and serializing the registry.

**Tech Stack:** TypeScript, Vitest, Bun (build scripts)

---

## File Map

| File                               | Action | Responsibility                                                                                                                               |
| ---------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/registry.ts`                  | Modify | Add `MacroMetadata`, `ParameterDef` types; parallel metadata Map; `registerMacroMetadata()`, `getMacroRegistry()`, `clearMetadataRegistry()` |
| `src/define-macro.ts`              | Modify | Add `description`, `parameters` to `MacroDefinition`; store metadata on registration; accept `source` param                                  |
| `src/components/macros/*.tsx`      | Modify | Add `block: true` to 11 builtin macros that are only block via hardcoded `BLOCK_MACROS` set                                                  |
| `src/story-api.ts`                 | Modify | Add `getMacroRegistry()` to interface and implementation; pass `source: 'user'`                                                              |
| `pkg/types/index.d.ts`             | Modify | Add `MacroMetadata`, `ParameterDef` types; add `getMacroRegistry()` to `StoryAPI`                                                            |
| `pkg/tooling.js`                   | Create | Metadata-only `defineMacro` shim + `getMacroRegistry` for Node.js                                                                            |
| `pkg/types/tooling.d.ts`           | Create | Type declarations for `@rohal12/spindle/tooling`                                                                                             |
| `scripts/dump-macro-registry.ts`   | Create | Build-time script to serialize builtin metadata to JSON                                                                                      |
| `scripts/build-format.ts`          | Modify | Copy tooling files to `dist/pkg/`; run dump script                                                                                           |
| `package.json`                     | Modify | Add `./tooling` export; add files                                                                                                            |
| `test/unit/macro-registry.test.ts` | Create | Tests for metadata storage, retrieval, source tracking                                                                                       |
| `test/unit/tooling-entry.test.ts`  | Create | Tests for the tooling entry point                                                                                                            |

---

### Task 1: Add MacroMetadata types and metadata storage to registry

**Files:**

- Modify: `src/registry.ts`
- Test: `test/unit/macro-registry.test.ts`

- [ ] **Step 1: Write failing tests for metadata storage and retrieval**

Create `test/unit/macro-registry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerMacroMetadata,
  getMacroRegistry,
  clearMetadataRegistry,
} from '../../src/registry';
import type { MacroMetadata } from '../../src/registry';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/macro-registry.test.ts`
Expected: FAIL — `registerMacroMetadata`, `getMacroRegistry`, `clearMetadataRegistry` not exported

- [ ] **Step 3: Implement metadata types and storage in registry.ts**

Add to `src/registry.ts` (after existing code):

```typescript
export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
}

export interface MacroMetadata {
  name: string;
  block: boolean;
  subMacros: string[];
  storeVar?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  source: 'builtin' | 'user';
  description?: string;
  parameters?: ParameterDef[];
}

const metadataRegistry = new Map<string, MacroMetadata>();

export function registerMacroMetadata(
  name: string,
  metadata: MacroMetadata,
): void {
  metadataRegistry.set(name.toLowerCase(), metadata);
}

export function getMacroRegistry(): MacroMetadata[] {
  return Array.from(metadataRegistry.values());
}

export function clearMetadataRegistry(): void {
  metadataRegistry.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/macro-registry.test.ts`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/registry.ts test/unit/macro-registry.test.ts
git commit -m "feat: add MacroMetadata types and metadata storage to registry"
```

---

### Task 2: Add `block: true` to builtin macro configs

Currently, 11 builtin macros are block macros only because they appear in the hardcoded `BLOCK_MACROS` set in `src/markup/ast.ts`. Their `defineMacro()` configs don't include `block: true`. Since the metadata API derives block status from the config, we need to make the config the source of truth.

**Files:**

- Modify: `src/components/macros/If.tsx`
- Modify: `src/components/macros/For.tsx`
- Modify: `src/components/macros/Do.tsx`
- Modify: `src/components/macros/Button.tsx`
- Modify: `src/components/macros/MacroLink.tsx`
- Modify: `src/components/macros/Cycle.tsx`
- Modify: `src/components/macros/Repeat.tsx`
- Modify: `src/components/macros/Type.tsx`
- Modify: `src/components/macros/Widget.tsx`
- Modify: `src/components/macros/Span.tsx`
- Modify: `src/components/macros/Nobr.tsx`

Macros that already have correct configs (no changes needed):

- `switch` — has `subMacros: ['case', 'default']` (implies block)
- `timed` — has `subMacros: ['next']` (implies block)
- `listbox` — has `subMacros: ['option']` (implies block)
- `dialog` — already has `block: true`

- [ ] **Step 1: Add `block: true` to each macro config**

For each file, add `block: true` to the `defineMacro({...})` config object:

- `src/components/macros/If.tsx`: `defineMacro({ name: 'if', block: true, interpolate: true, merged: true, ...`
- `src/components/macros/For.tsx`: `defineMacro({ name: 'for', block: true, interpolate: true, merged: true, ...`
- `src/components/macros/Do.tsx`: `defineMacro({ name: 'do', block: true, ...`
- `src/components/macros/Button.tsx`: `defineMacro({ name: 'button', block: true, interpolate: true, ...`
- `src/components/macros/MacroLink.tsx`: `defineMacro({ name: 'link', block: true, interpolate: true, ...`
- `src/components/macros/Cycle.tsx`: `defineMacro({ name: 'cycle', block: true, storeVar: true, ...`
- `src/components/macros/Repeat.tsx`: `defineMacro({ name: 'repeat', block: true, interpolate: true, ...`
- `src/components/macros/Type.tsx`: `defineMacro({ name: 'type', block: true, interpolate: true, ...`
- `src/components/macros/Widget.tsx`: `defineMacro({ name: 'widget', block: true, ...`
- `src/components/macros/Span.tsx`: `defineMacro({ name: 'span', block: true, ...`
- `src/components/macros/Nobr.tsx`: `defineMacro({ name: 'nobr', block: true, ...`

- [ ] **Step 2: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass. The `block: true` flag causes `defineMacro()` to call `registerBlockMacro()`, which adds to the same `BLOCK_MACROS` set — redundant with the hardcoded entries but harmless.

- [ ] **Step 3: Commit**

```bash
git add src/components/macros/If.tsx src/components/macros/For.tsx src/components/macros/Do.tsx src/components/macros/Button.tsx src/components/macros/MacroLink.tsx src/components/macros/Cycle.tsx src/components/macros/Repeat.tsx src/components/macros/Type.tsx src/components/macros/Widget.tsx src/components/macros/Span.tsx src/components/macros/Nobr.tsx
git commit -m "refactor: add block: true to builtin macro configs for metadata accuracy"
```

---

### Task 3: Store metadata during defineMacro registration

**Files:**

- Modify: `src/define-macro.ts`
- Test: `test/unit/macro-registry.test.ts` (extend)

- [ ] **Step 1: Write failing tests for defineMacro metadata storage**

Append to `test/unit/macro-registry.test.ts`:

```typescript
import { defineMacro } from '../../src/define-macro';

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/macro-registry.test.ts`
Expected: FAIL — `defineMacro` does not yet store metadata; second parameter not accepted

- [ ] **Step 3: Extend MacroDefinition and defineMacro to store metadata**

In `src/define-macro.ts`:

1. Add `description` and `parameters` to `MacroDefinition`:

```typescript
export interface MacroDefinition {
  name: string;
  subMacros?: string[];
  block?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  storeVar?: boolean;
  description?: string;
  parameters?: ParameterDef[];
  render: (props: MacroProps, ctx: MacroContext) => VNode | null;
}
```

2. Add import for `ParameterDef` and `registerMacroMetadata`:

```typescript
import {
  registerMacro,
  registerSubMacro,
  registerMacroMetadata,
} from './registry';
import type { MacroProps, ParameterDef } from './registry';
```

3. Update `defineMacro` signature and add metadata registration at the end:

```typescript
export function defineMacro(
  config: MacroDefinition,
  source: 'builtin' | 'user' = 'builtin',
): void {
  // ... existing Wrapper function unchanged ...

  registerMacro(config.name, Wrapper);

  // Store metadata for tooling API
  const isBlock =
    config.block === true ||
    (config.block !== false && (config.subMacros?.length ?? 0) > 0);
  registerMacroMetadata(config.name, {
    name: config.name,
    block: isBlock,
    subMacros: config.subMacros ?? [],
    storeVar: config.storeVar,
    interpolate: config.interpolate,
    merged: config.merged,
    description: config.description,
    parameters: config.parameters,
    source,
  });

  if (config.subMacros) {
    for (const sub of config.subMacros) registerSubMacro(sub);
  }
  if (isBlock) {
    registerBlockMacro(config.name);
  }
}
```

Note: the `isBlock` logic is extracted to avoid duplicating the condition.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/macro-registry.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All existing tests pass

- [ ] **Step 6: Commit**

```bash
git add src/define-macro.ts src/registry.ts test/unit/macro-registry.test.ts
git commit -m "feat: store macro metadata during defineMacro registration"
```

---

### Task 4: Add getMacroRegistry to Story API

**Files:**

- Modify: `src/story-api.ts`
- Test: `test/unit/story-api.test.ts` (extend)

- [ ] **Step 1: Write failing test for Story.getMacroRegistry**

Append to the `describe('StoryAPI')` block in `test/unit/story-api.test.ts`:

```typescript
describe('getMacroRegistry', () => {
  it('is available on the Story API', () => {
    expect(typeof Story.getMacroRegistry).toBe('function');
  });

  it('returns metadata for registered macros', () => {
    const registry = Story.getMacroRegistry();
    expect(Array.isArray(registry)).toBe(true);
    // Builtins are registered via vitest setupFiles
    expect(registry.length).toBeGreaterThan(0);
    const setMacro = registry.find((m: any) => m.name === 'set');
    expect(setMacro).toBeDefined();
    expect(setMacro.source).toBe('builtin');
  });

  it('marks user-defined macros with source user', () => {
    Story.defineMacro({ name: 'user-test-macro', render: () => null });
    const registry = Story.getMacroRegistry();
    const userMacro = registry.find((m: any) => m.name === 'user-test-macro');
    expect(userMacro).toBeDefined();
    expect(userMacro.source).toBe('user');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: FAIL — `Story.getMacroRegistry` is not a function

- [ ] **Step 3: Add getMacroRegistry to StoryAPI interface and implementation**

In `src/story-api.ts`:

1. Add aliased imports to avoid name shadowing with object methods:

```typescript
import { getMacroRegistry as _getMacroRegistry } from './registry';
import type { MacroMetadata } from './registry';
```

2. Add to `StoryAPI` interface (after `defineMacro`):

```typescript
getMacroRegistry(): MacroMetadata[];
```

3. Update `defineMacro` in `createStoryAPI()` to pass `'user'` source, and add `getMacroRegistry`:

```typescript
defineMacro(config: MacroDefinition): void {
  defineMacro(config, 'user');
},

getMacroRegistry(): MacroMetadata[] {
  return _getMacroRegistry();
},
```

Note: The imported function is aliased as `_getMacroRegistry` to avoid shadowing with the object method name. The `defineMacro` call now passes `'user'` as the source (the import `defineMacro` from `./define-macro` resolves via closure scope, not `this`).

4. Re-export `MacroMetadata` from story-api.ts:

```typescript
export type { MacroMetadata };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/unit/story-api.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/story-api.ts test/unit/story-api.test.ts
git commit -m "feat: add getMacroRegistry to Story API"
```

---

### Task 5: Update public type declarations

**Files:**

- Modify: `pkg/types/index.d.ts`

- [ ] **Step 1: Add MacroMetadata and ParameterDef types**

Add before the `StoryAPI` interface in `pkg/types/index.d.ts`:

```typescript
/**
 * Typed parameter definition for macro tooling metadata.
 * Macro authors can provide these to help LSP servers, linters, and documentation generators.
 */
export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
}

/**
 * Metadata about a registered macro, used by tooling (LSP, linters, doc generators).
 * Available at runtime via `Story.getMacroRegistry()` or via the `@rohal12/spindle/tooling` entry point.
 */
export interface MacroMetadata {
  name: string;
  block: boolean;
  subMacros: string[];
  storeVar?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  source: 'builtin' | 'user';
  description?: string;
  parameters?: ParameterDef[];
}
```

- [ ] **Step 2: Add getMacroRegistry to StoryAPI interface**

Add to the `StoryAPI` interface (after the `saves` property):

```typescript
/** Return metadata for all registered macros (built-in and user-defined). */
getMacroRegistry(): MacroMetadata[];
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add pkg/types/index.d.ts
git commit -m "feat: add MacroMetadata types to public type declarations"
```

---

### Task 6: Create tooling entry point

**Files:**

- Create: `pkg/tooling.js`
- Create: `pkg/types/tooling.d.ts`
- Modify: `package.json`

- [ ] **Step 1: Write test for tooling entry point**

Create `test/unit/tooling-entry.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, existsSync } from 'fs';
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/unit/tooling-entry.test.ts`
Expected: Contract tests pass (they're self-contained), but file existence tests fail

- [ ] **Step 3: Create pkg/tooling.js**

```javascript
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load built-in macro metadata generated at build time
const registryPath = join(__dirname, 'macro-registry.json');
let builtins = [];
try {
  builtins = JSON.parse(readFileSync(registryPath, 'utf-8'));
} catch {
  // macro-registry.json not yet built — empty builtins
}

const metadata = new Map();
for (const m of builtins) metadata.set(m.name.toLowerCase(), m);

/**
 * Metadata-only defineMacro for tooling.
 * Captures macro metadata without creating Preact components.
 * LSP servers call this to register user-defined macros discovered in story scripts.
 */
export function defineMacro(config) {
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

/**
 * Return metadata for all registered macros (built-in + user-defined).
 */
export function getMacroRegistry() {
  return Array.from(metadata.values());
}
```

- [ ] **Step 4: Create pkg/types/tooling.d.ts**

```typescript
export interface ParameterDef {
  name: string;
  required?: boolean;
  description?: string;
}

export interface MacroMetadata {
  name: string;
  block: boolean;
  subMacros: string[];
  storeVar?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  source: 'builtin' | 'user';
  description?: string;
  parameters?: ParameterDef[];
}

export interface MacroDefinition {
  name: string;
  subMacros?: string[];
  block?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  storeVar?: boolean;
  description?: string;
  parameters?: ParameterDef[];
  render: (...args: any[]) => any;
}

/**
 * Metadata-only defineMacro for tooling.
 * Captures macro metadata without creating Preact components.
 * LSP servers call this to register user-defined macros discovered in story scripts.
 */
export declare function defineMacro(config: MacroDefinition): void;

/**
 * Return metadata for all registered macros (built-in + user-defined).
 */
export declare function getMacroRegistry(): MacroMetadata[];
```

- [ ] **Step 5: Update package.json**

Add `"./tooling"` export and update `files`:

In `exports`:

```json
"exports": {
  ".": {
    "types": "./types/index.d.ts",
    "import": "./dist/pkg/index.js"
  },
  "./tooling": {
    "types": "./types/tooling.d.ts",
    "import": "./dist/pkg/tooling.js"
  }
}
```

In `files`, add `"dist/pkg/tooling.js"` and `"dist/pkg/macro-registry.json"`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run test/unit/tooling-entry.test.ts`
Expected: All tests pass (including file existence checks)

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add pkg/tooling.js pkg/types/tooling.d.ts package.json test/unit/tooling-entry.test.ts
git commit -m "feat: create tooling entry point for Node.js LSP use"
```

---

### Task 7: Build-time macro registry dump

**Files:**

- Create: `scripts/dump-macro-registry.ts`
- Modify: `scripts/build-format.ts`

- [ ] **Step 1: Create dump-macro-registry.ts script**

Create `scripts/dump-macro-registry.ts`:

```typescript
/**
 * Dump the built-in macro registry metadata to JSON.
 * Run after register-builtins has been imported (side-effect registration).
 *
 * Usage: bun run scripts/dump-macro-registry.ts
 * Output: dist/pkg/macro-registry.json
 */
import '../src/macros/register-builtins';
import { getMacroRegistry } from '../src/registry';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(__dirname, '..', 'dist', 'pkg');
mkdirSync(outputDir, { recursive: true });

const registry = getMacroRegistry();
const outputPath = resolve(outputDir, 'macro-registry.json');
writeFileSync(outputPath, JSON.stringify(registry, null, 2), 'utf-8');

console.log(
  `Dumped ${registry.length} macro metadata entries to dist/pkg/macro-registry.json`,
);
```

- [ ] **Step 2: Update build-format.ts to copy tooling files and run dump**

Add to `scripts/build-format.ts`, after the existing `console.log('Built dist/pkg/ (npm package)')` line:

```typescript
// Copy tooling entry point
copyFileSync(
  resolve(projectRoot, 'pkg/tooling.js'),
  resolve(pkgDir, 'tooling.js'),
);

// Copy tooling type declarations
copyFileSync(
  resolve(projectRoot, 'pkg/types/tooling.d.ts'),
  resolve(pkgTypesDir, 'tooling.d.ts'),
);

console.log('Copied tooling entry point to dist/pkg/');
```

Note: The `macro-registry.json` is generated by a separate `bun run scripts/dump-macro-registry.ts` call. Update the `build` script in `package.json`:

```json
"build": "vite build && bun run scripts/build-format.ts && bun run scripts/dump-macro-registry.ts"
```

- [ ] **Step 3: Test the build**

Run: `npm run build`
Expected: Build completes successfully. `dist/pkg/macro-registry.json` exists and contains an array of macro metadata objects. `dist/pkg/tooling.js` exists.

- [ ] **Step 4: Verify dump output**

Run: `cat dist/pkg/macro-registry.json | head -30`
Expected: JSON array with entries like `{"name": "set", "block": false, "subMacros": [], "source": "builtin", ...}`

- [ ] **Step 5: Commit**

```bash
git add scripts/dump-macro-registry.ts scripts/build-format.ts package.json
git commit -m "feat: generate macro-registry.json at build time for tooling entry point"
```

---

### Task 8: Verify builtins have metadata after registration

**Files:**

- Test: `test/unit/macro-registry.test.ts` (extend)

- [ ] **Step 1: Write test that builtins are registered with metadata**

Builtins are auto-registered via vitest `setupFiles`. Add to `test/unit/macro-registry.test.ts`:

```typescript
describe('builtin macros have metadata', () => {
  // NOTE: do NOT call clearMetadataRegistry() here — we want builtins

  it('all expected builtins are present', () => {
    const registry = getMacroRegistry();
    const names = registry.map((m) => m.name);
    // Spot-check a selection of builtins
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
    // Filter to known builtins (registry may have test macros from other describe blocks)
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
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run test/unit/macro-registry.test.ts`
Expected: All tests pass

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add test/unit/macro-registry.test.ts
git commit -m "test: verify builtin macros have correct metadata"
```
