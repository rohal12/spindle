import { describe, it, expect } from 'vitest';
import {
  controlEditVersion,
  editedItem,
  noteControlEdit,
} from '../../src/utils/control-edits';

describe('editedItem (#380)', () => {
  it('attributes an edit to the item it wrote inside', () => {
    const item = { name: 'a' };
    const vars = { items: [item], text: 'A' };
    const since = controlEditVersion();
    noteControlEdit(['items', '0', 'name']);
    expect(editedItem(since, vars, vars.items, item, 0)).toBe(true);
  });

  it('does not attribute an edit elsewhere to a replaced item', () => {
    const vars = { items: [{ name: 'new' }], text: 'A' };
    const since = controlEditVersion();
    noteControlEdit(['text']);
    expect(editedItem(since, vars, vars.items, vars.items[0], 0)).toBe(false);
  });

  it('attributes an edit of a primitive list slot', () => {
    const vars = { items: ['x', 'y'] };
    const since = controlEditVersion();
    noteControlEdit(['items', '1']);
    expect(editedItem(since, vars, vars.items, 'y', 1)).toBe(true);
    expect(editedItem(since, vars, vars.items, 'x', 0)).toBe(false);
  });
});
