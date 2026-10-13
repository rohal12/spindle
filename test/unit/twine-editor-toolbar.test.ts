import { describe, it, expect } from 'vitest';
import type CodeMirror from 'codemirror';
import { validateStoryMarkup } from '../../src/tooling';
import { builtinMacros } from '../../src/twine-editor/builtin-macros';
import { snippets } from '../../src/twine-editor/snippets';
import {
  toolbar,
  type ToolbarEnvironment,
  type ToolbarItem,
} from '../../src/twine-editor/toolbar';

/** The only part of the editor the toolbar reads. */
function editorWith(text: string): CodeMirror.Editor {
  return { getValue: () => text } as unknown as CodeMirror.Editor;
}

const light: ToolbarEnvironment = {
  appTheme: 'light',
  foregroundColor: '#111111',
  locale: 'en-US',
};
const dark: ToolbarEnvironment = {
  appTheme: 'dark',
  foregroundColor: '#eeeeee',
  locale: 'de-DE',
};

/** What each snippet's cursor slot holds when the author has filled it in. */
const slotFill: Record<string, string> = {
  'bracket-link': 'P',
  link: 'Go',
  goto: 'P',
  include: 'P',
  back: '',
  if: '$x',
  'if-else': '$x',
  for: '$x',
  switch: '$x',
  do: '$x = 1;',
  watch: '$x',
  set: '$x = 1',
  unset: '$x',
  print: '$x',
  display: 'x',
  computed: '$x = 1',
  textbox: '$x',
  numberbox: '$x',
  textarea: '$x',
  checkbox: '$x',
  radiobutton: '$x',
  listbox: '$x',
  cycle: '$x',
  button: 'Go',
  dialog: 'Go',
  repeat: '1s',
  timed: '1s',
  meter: '$x',
  nobr: '',
  widget: 'Name',
};

/** The selection a snippet wraps, where it is not story text. */
const bodyFor = (id: string) => (id === 'do' ? ';' : 'body');

const items = toolbar(editorWith('text'), light);

function sequence(list: ToolbarItem[]): unknown[] {
  return list.map((item) =>
    item.type === 'menu'
      ? { type: item.type, label: item.label, items: sequence(item.items) }
      : item.type === 'button'
        ? { type: item.type, label: item.label, command: item.command }
        : { type: item.type },
  );
}

describe('toolbar items', () => {
  it('gives top-level items an icon and menu items none', () => {
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.type).not.toBe('separator');
      if (item.type === 'separator') continue;
      expect(item.icon).toMatch(/^data:image\/svg\+xml/);
      if (item.type === 'menu') {
        for (const inner of item.items)
          expect(inner).not.toHaveProperty('icon');
      }
    }
  });

  it('labels every item', () => {
    const all = items.flatMap((i) =>
      i.type === 'menu' ? [i, ...i.items] : [i],
    );
    for (const item of all) {
      if (item.type === 'separator') continue;
      expect(item.label.length).toBeGreaterThan(0);
      expect(item.label).not.toMatch(/[<>]/);
    }
  });

  it('puts separators only inside menus', () => {
    expect(items.some((i) => i.type === 'separator')).toBe(false);
  });

  it('lists the five menus, Check and Format in order', () => {
    expect(items.map((i) => (i.type === 'separator' ? '' : i.label))).toEqual([
      'Links',
      'Logic',
      'Variables',
      'Inputs',
      'UI',
      'Check',
      'Format',
    ]);
  });

  it('has a snippet command for every snippet, each in one menu', () => {
    const commands = items.flatMap((i) =>
      i.type === 'menu'
        ? i.items.flatMap((m) => (m.type === 'button' ? [m.command] : []))
        : [],
    );
    expect(commands).toEqual(snippets.map((s) => `snippet:${s.id}`));
  });

  it('runs check and format from the top-level buttons', () => {
    const buttons = items.flatMap((i) => (i.type === 'button' ? [i] : []));
    expect(buttons.map((b) => b.command)).toEqual(['check', 'format']);
  });

  it('is the same for any editor, theme and locale', () => {
    expect(sequence(toolbar(editorWith(''), dark))).toEqual(sequence(items));
    expect(sequence(toolbar(editorWith('abc'), dark))).toEqual(sequence(items));
  });

  it('draws icons in the foreground colour', () => {
    const icon = (list: ToolbarItem[]) =>
      list.flatMap((i) => (i.type === 'separator' ? [] : [i.icon ?? '']));
    for (const url of icon(toolbar(editorWith('x'), dark)))
      expect(decodeURIComponent(url)).toContain('#eeeeee');
  });

  it('disables Check and Format exactly when the passage is empty', () => {
    const state = (text: string) =>
      toolbar(editorWith(text), light)
        .filter((i) => i.type === 'button')
        .map((i) => i.type === 'button' && i.disabled);
    expect(state('')).toEqual([true, true]);
    expect(state(' ')).toEqual([false, false]);
    expect(state('text')).toEqual([false, false]);
  });

  it('does not change the editor', () => {
    const calls: string[] = [];
    const editor = new Proxy(
      { getValue: () => 'x' },
      {
        get(target, key) {
          calls.push(String(key));
          return (target as Record<string | symbol, unknown>)[key];
        },
      },
    ) as unknown as CodeMirror.Editor;
    toolbar(editor, light);
    expect([...new Set(calls)]).toEqual(['getValue']);
  });
});

describe('snippets', () => {
  it('has unique ids and one fill value each', () => {
    const ids = snippets.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(slotFill).sort()).toEqual([...ids].sort());
  });

  it.each(snippets.map((s) => [s.id, s] as const))(
    '%s has one cursor slot in its opening part',
    (_id, snippet) => {
      expect(snippet.before.split('|')).toHaveLength(2);
      expect(snippet.after).not.toContain('|');
    },
  );

  it.each(snippets.map((s) => [s.id, s] as const))(
    '%s passes the validator, with and without a body',
    (id, snippet) => {
      const fill = slotFill[id] ?? '';
      const empty = snippet.before.replace('|', fill) + snippet.after;
      const wrapped =
        snippet.before.replace('|', fill) + bodyFor(id) + snippet.after;
      for (const content of [empty, wrapped]) {
        expect(
          validateStoryMarkup([{ name: 'P', content }], builtinMacros, {
            checkPassageNames: false,
          }),
          content,
        ).toEqual([]);
      }
    },
  );
});
