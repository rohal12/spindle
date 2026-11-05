import { expect, it, vi } from 'vitest';
import { getMacroRegistry } from '../../src/registry';

const builtins = getMacroRegistry();

it('pairs builtin blocks without runtime registration (#723)', async () => {
  // The global test setup registers builtins. A fresh module graph models
  // the standalone tooling entry, which deliberately has no runtime preload.
  vi.resetModules();
  const { isBlockMacro, tokenizeMarkup, pairMarkup } =
    await import('../../src/tooling');
  const { getMacroRegistry: standaloneRegistry } =
    await import('../../src/registry');
  expect(standaloneRegistry()).toEqual([]);
  for (const macro of builtins) {
    expect(isBlockMacro(macro.name), macro.name).toBe(macro.block);
  }
  const source = '{dialog "Open"}Help{/dialog}';
  const paired = pairMarkup(tokenizeMarkup(source));
  expect(paired.errors).toEqual([]);
  expect(paired.nodes).toMatchObject([
    {
      token: { type: 'macro', name: 'dialog' },
      body: { children: [{ token: { type: 'text', value: 'Help' } }] },
    },
  ]);
});
