import type CodeMirror from 'codemirror';
import { icon, type IconName } from './icons';
import { snippets, type Snippet } from './snippets';

/** The items Twine 2.4+ accepts from `codeMirror.toolbar`. */
export type ToolbarItem =
  | {
      type: 'button';
      command: string;
      label: string;
      /** Required at the top level, not allowed inside a menu. */
      icon?: string;
      disabled?: boolean;
      iconOnly?: boolean;
    }
  | {
      type: 'menu';
      icon: string;
      label: string;
      items: ToolbarMenuItem[];
      disabled?: boolean;
    }
  | { type: 'separator' };

export type ToolbarMenuItem = Extract<
  ToolbarItem,
  { type: 'button' | 'separator' }
>;

export interface ToolbarEnvironment {
  appTheme: 'dark' | 'light';
  foregroundColor: string;
  locale: string;
}

const menus: readonly { id: Snippet['menu']; label: string }[] = [
  { id: 'links', label: 'Links' },
  { id: 'logic', label: 'Logic' },
  { id: 'variables', label: 'Variables' },
  { id: 'inputs', label: 'Inputs' },
  { id: 'ui', label: 'UI' },
];

/**
 * The toolbar above the passage editor: one menu of snippets per group, then
 * Check and Format. The items are the same for every editor, theme and
 * locale; only Check and Format are disabled while the passage is empty. The
 * commands they run are in `codeMirror.commands`.
 */
export function toolbar(
  editor: CodeMirror.Editor,
  environment: ToolbarEnvironment,
): ToolbarItem[] {
  const color = environment.foregroundColor;
  const empty = editor.getValue() === '';
  const named = (name: IconName) => icon(name, color);
  return [
    ...menus.map(({ id, label }): ToolbarItem => ({
      type: 'menu',
      icon: named(id),
      label,
      items: snippets
        .filter((snippet) => snippet.menu === id)
        .map((snippet) => ({
          type: 'button',
          command: `snippet:${snippet.id}`,
          label: snippet.label,
        })),
    })),
    {
      type: 'button',
      command: 'check',
      label: 'Check',
      icon: named('check'),
      disabled: empty,
    },
    {
      type: 'button',
      command: 'format',
      label: 'Format',
      icon: named('format'),
      disabled: empty,
    },
  ];
}
