import { describe, it, expect } from 'vitest';
import {
  controlEditVersion,
  editedItems,
  runAsControlEdit,
  runAsItemEdit,
} from '../../src/utils/control-edits';
import { useStoryStore } from '../../src/store';
import type { VariableNamespaces } from '../../src/store';
import { mutateState } from '../../src/execute-mutation';
import { setByPath } from '../../src/utils/object-path';

/** Namespaces holding `variables`. */
const state = (variables: Record<string, unknown>): VariableNamespaces => ({
  variables,
  temporary: {},
  transient: {},
});

function noteControlEdit(
  path: string[],
  variables: Record<string, unknown>,
): void {
  useStoryStore.setState({ variables });
  runAsControlEdit(path, () =>
    useStoryStore.getState().updateVariables(() => {}),
  );
}

describe('editedItems (#380)', () => {
  it('attributes an edit to the item it wrote inside', () => {
    const item = { name: 'a' };
    const vars = { items: [item], text: 'A' };
    const since = controlEditVersion();
    noteControlEdit(['items', '0', 'name'], vars);
    expect(editedItems(since, state(vars))(vars.items, item, 0)).toBe(true);
  });

  it('does not attribute an edit elsewhere to a replaced item', () => {
    const vars = { items: [{ name: 'new' }], text: 'A' };
    const since = controlEditVersion();
    noteControlEdit(['text'], vars);
    expect(editedItems(since, state(vars))(vars.items, vars.items[0], 0)).toBe(
      false,
    );
  });

  it('attributes an edit of a primitive list slot', () => {
    const vars = { items: ['x', 'y'] };
    const since = controlEditVersion();
    noteControlEdit(['items', '1'], vars);
    const edited = editedItems(since, state(vars));
    expect(edited(vars.items, 'y', 1)).toBe(true);
    expect(edited(vars.items, 'x', 0)).toBe(false);
  });

  it('ignores edits made before `since`', () => {
    const item = { name: 'a' };
    const vars = { items: [item] };
    noteControlEdit(['items', '0', 'name'], vars);
    const since = controlEditVersion();
    expect(editedItems(since, state(vars))(vars.items, item, 0)).toBe(false);
  });
});

describe('runAsItemEdit (#400)', () => {
  it('notes the paths the code changed, in every namespace', () => {
    useStoryStore.setState({
      variables: { party: [{ hp: 0 }, { hp: 5 }] },
      temporary: { team: [{ hp: 1 }] },
    });
    const since = controlEditVersion();
    runAsItemEdit(() => {
      useStoryStore.getState().updateVariables((draft) => {
        (draft.variables.party as { hp: number }[])[0]!.hp = 1;
        (draft.temporary.team as { hp: number }[])[0]!.hp = 2;
      });
    });
    const now = useStoryStore.getState();
    const edited = editedItems(since, now);
    const party = now.variables.party as object[];
    const team = now.temporary.team as object[];
    expect(edited(party, party[0], 0)).toBe(true);
    expect(edited(party, party[1], 1)).toBe(false);
    expect(edited(team, team[0], 0)).toBe(true);
  });
});

function controlWrite(path: string[], value: unknown): void {
  runAsControlEdit(path, () => {
    mutateState((work, adopt) => setByPath(work.variables, path, adopt(value)));
  });
}

it.each(['object', 'primitive'])(
  'does not attribute a synchronous watcher replacement to a control (%s, #778)',
  (kind) => {
    const object = kind === 'object';
    useStoryStore.setState({
      variables: { items: object ? [{ name: 'old' }] : ['old'] },
    });
    const since = controlEditVersion();
    let replaced = false;
    const stop = useStoryStore.subscribe(() => {
      if (replaced) return;
      replaced = true;
      mutateState((work) => {
        work.variables.items = object ? [{ name: 'new' }] : ['new'];
      });
    });
    try {
      controlWrite(object ? ['items', '0', 'name'] : ['items', '0'], 'typed');
    } finally {
      stop();
    }
    const now = useStoryStore.getState();
    const items = now.variables.items as unknown[];
    expect(editedItems(since, now)(items, items[0], 0)).toBe(false);
  },
);

it('does not attribute watcher writes to loop-body mutation code (#778)', () => {
  useStoryStore.setState({ variables: { items: [{ name: 'old' }] } });
  const since = controlEditVersion();
  let replaced = false;
  const stop = useStoryStore.subscribe(() => {
    if (replaced) return;
    replaced = true;
    mutateState((work) => {
      work.variables.items = [{ name: 'new' }];
    });
  });
  try {
    runAsItemEdit(() =>
      mutateState((work) => {
        (work.variables.items as { name: string }[])[0]!.name = 'typed';
      }),
    );
  } finally {
    stop();
  }
  const now = useStoryStore.getState();
  const items = now.variables.items as unknown[];
  expect(editedItems(since, now)(items, items[0], 0)).toBe(false);
});

it('keeps attribution for primitive slots across batched edits of other slots (#778)', () => {
  useStoryStore.setState({ variables: { items: ['a', 'b'] } });
  const since = controlEditVersion();
  controlWrite(['items', '0'], 'A');
  controlWrite(['items', '1'], 'B');
  const now = useStoryStore.getState();
  const items = now.variables.items as unknown[];
  const edited = editedItems(since, now);
  expect(edited(items, items[0], 0)).toBe(true);
  expect(edited(items, items[1], 1)).toBe(true);
});

it('restores edit attribution after a throwing action (#778)', () => {
  useStoryStore.setState({ variables: { items: ['old'] } });
  const since = controlEditVersion();
  expect(() =>
    runAsItemEdit(() => {
      throw new Error('stop');
    }),
  ).toThrow('stop');
  mutateState((work) => {
    work.variables.items = ['new'];
  });
  const now = useStoryStore.getState();
  const items = now.variables.items as unknown[];
  expect(editedItems(since, now)(items, items[0], 0)).toBe(false);
});

it('retains earlier object edits when the next loop-body commit copies the list (#400, #778)', () => {
  useStoryStore.setState({ variables: { items: [{ hp: 0 }, { hp: 10 }] } });
  const since = controlEditVersion();
  for (let i = 0; i < 2; i++) {
    runAsItemEdit(() =>
      mutateState((work) => {
        (work.variables.items as { hp: number }[])[i]!.hp++;
      }),
    );
  }
  const now = useStoryStore.getState();
  const items = now.variables.items as unknown[];
  const edited = editedItems(since, now);
  expect(edited(items, items[0], 0)).toBe(true);
  expect(edited(items, items[1], 1)).toBe(true);
});

it('retains a genuine edit when a watcher changes another row (#778)', () => {
  useStoryStore.setState({
    variables: { items: [{ name: 'old' }, { name: 'other' }] },
  });
  const since = controlEditVersion();
  let replaced = false;
  const stop = useStoryStore.subscribe(() => {
    if (replaced) return;
    replaced = true;
    mutateState((work) => {
      (work.variables.items as { name: string }[])[1]!.name = 'updated';
    });
  });
  try {
    controlWrite(['items', '0', 'name'], 'typed');
  } finally {
    stop();
  }
  const now = useStoryStore.getState();
  const items = now.variables.items as unknown[];
  const edited = editedItems(since, now);
  expect(edited(items, items[0], 0)).toBe(true);
  expect(edited(items, items[1], 1)).toBe(false);
});

it('does not traverse unrelated store data to attribute a scalar control edit (#778)', () => {
  let reads = 0;
  const renderCounts = Object.freeze(
    Object.defineProperty({}, 'unused', {
      enumerable: true,
      get() {
        reads++;
        return 0;
      },
    }),
  );
  useStoryStore.setState({ variables: { text: 'old' }, renderCounts });
  reads = 0;
  controlWrite(['text'], 'typed');
  expect(reads).toBe(0);
});
