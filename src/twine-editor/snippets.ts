export interface Snippet {
  /** The command name suffix: the command is `snippet:<id>`. */
  id: string;
  /** The menu item's label. */
  label: string;
  menu: 'links' | 'logic' | 'variables' | 'inputs' | 'ui';
  /**
   * Inserted before the selection. Its one `|` marks the cursor slot, where
   * the cursor goes when nothing is selected; it is not inserted.
   */
  before: string;
  /** Inserted after the selection ('' for a snippet that does not wrap). */
  after: string;
}

type Row = readonly [id: string, label: string, before: string, after?: string];

/** The snippets of one menu from rows of `[id, label, before, after]`. */
function group(menu: Snippet['menu'], rows: readonly Row[]): Snippet[] {
  return rows.map(([id, label, before, after = '']) => ({
    id,
    label,
    menu,
    before,
    after,
  }));
}

/**
 * The templates follow `docs/macros.md`. A block macro wraps the selection as
 * its body; the slot is where the author types next.
 */
export const snippets: readonly Snippet[] = [
  ...group('links', [
    ['bracket-link', 'Link [[…]]', '[[|', ']]'],
    ['link', 'Link macro…', '{link "|" "Passage"}', '{/link}'],
    ['goto', 'Go to…', '{goto "|"}'],
    ['include', 'Include…', '{include "|"}'],
    ['back', 'Back', '{back}|'],
  ]),
  ...group('logic', [
    ['if', 'If…', '{if |}', '{/if}'],
    ['if-else', 'If / else…', '{if |}', '{else}{/if}'],
    ['for', 'For each…', '{for @item of |}', '{/for}'],
    ['switch', 'Switch…', '{switch |}{case 1}', '{default}{/switch}'],
    ['do', 'Do (code)', '{do}|', '{/do}'],
    ['watch', 'Watch…', `{watch '|' dialog "Passage" once}`],
  ]),
  ...group('variables', [
    ['set', 'Set…', '{set |}'],
    ['unset', 'Unset…', '{unset |}'],
    ['print', 'Print…', '{print |}'],
    ['display', 'Display {$x}', '{$|}'],
    ['computed', 'Computed…', '{computed |}'],
  ]),
  ...group('inputs', [
    ['textbox', 'Text box…', '{textbox |}'],
    ['numberbox', 'Number box…', '{numberbox |}'],
    ['textarea', 'Text area…', '{textarea |}'],
    ['checkbox', 'Checkbox…', '{checkbox | "Label"}'],
    ['radiobutton', 'Radio button…', '{radiobutton | "value" "Label"}'],
    ['listbox', 'List box…', '{listbox |}{option "Option"}', '{/listbox}'],
    ['cycle', 'Cycle…', '{cycle |}{option "Option"}', '{/cycle}'],
    ['button', 'Button…', '{button "|"}', '{/button}'],
  ]),
  ...group('ui', [
    ['dialog', 'Dialog…', '{dialog "|"}', '{/dialog}'],
    ['repeat', 'Repeat…', '{repeat |}', '{/repeat}'],
    ['timed', 'Timed…', '{timed |}', '{/timed}'],
    ['meter', 'Meter…', '{meter | 100}'],
    ['nobr', 'No line breaks', '{nobr}|', '{/nobr}'],
    ['widget', 'Widget…', '{widget "|"}', '{/widget}'],
  ]),
];
