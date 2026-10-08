// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { quickSave, startNewPlaythrough } from '../../src/saves/save-manager';
import { resetBackend } from '../../src/saves/storage';
import type { SavePayload } from '../../src/saves/types';

const payload: SavePayload = {
  passage: 'Start',
  variables: {},
  history: [{ passage: 'Start', variables: {}, timestamp: 1 }],
  historyIndex: 0,
};

describe('slot index across tabs', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    resetBackend();
  });

  it('is updated holding a lock the story’s tabs share', async () => {
    const names: string[] = [];
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: {
        request: (name: string, cb: () => Promise<unknown>) => {
          names.push(name);
          return cb();
        },
      },
    });
    const ifid = 'lock-ifid';
    const pt = await startNewPlaythrough(ifid);
    await quickSave(ifid, pt, payload, 'slot-a');
    expect(names).toContain(`spindle-slot-index:${ifid}`);
    expect(names).toContain(`spindle-playthrough-count:${ifid}`);
  });
});
