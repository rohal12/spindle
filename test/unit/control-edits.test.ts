import { describe, it, expect } from 'vitest';
import {
  controlEditVersion,
  editedItems,
  noteControlEdit,
  runAsItemEdit,
} from '../../src/utils/control-edits';
import { useStoryStore } from '../../src/store';
import type { VariableNamespaces } from '../../src/store';

/** Namespaces holding `variables`. */
const state = (variables: Record<string, unknown>): VariableNamespaces => ({
  variables,
  temporary: {},
  transient: {},
});

describe('editedItems (#380)', () => {
  it('attributes an edit to the item it wrote inside', () => {
    const item = { name: 'a' };
    const vars = { items: [item], text: 'A' };
    const since = controlEditVersion();
    noteControlEdit(['items', '0', 'name']);
    expect(editedItems(since, state(vars))(vars.items, item, 0)).toBe(true);
  });

  it('does not attribute an edit elsewhere to a replaced item', () => {
    const vars = { items: [{ name: 'new' }], text: 'A' };
    const since = controlEditVersion();
    noteControlEdit(['text']);
    expect(editedItems(since, state(vars))(vars.items, vars.items[0], 0)).toBe(
      false,
    );
  });

  it('attributes an edit of a primitive list slot', () => {
    const vars = { items: ['x', 'y'] };
    const since = controlEditVersion();
    noteControlEdit(['items', '1']);
    const edited = editedItems(since, state(vars));
    expect(edited(vars.items, 'y', 1)).toBe(true);
    expect(edited(vars.items, 'x', 0)).toBe(false);
  });

  it('ignores edits made before `since`', () => {
    const item = { name: 'a' };
    const vars = { items: [item] };
    noteControlEdit(['items', '0', 'name']);
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
