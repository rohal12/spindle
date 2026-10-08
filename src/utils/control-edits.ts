/**
 * Counts the edits a reader made through a control bound to a story
 * variable (`{textbox}`, `{checkbox}`, ...). {for} tells these apart from a
 * list that is replaced: typing into a control inside an iteration changes
 * its item, but must not remount the iteration and drop the control's focus.
 */
let version = 0;

export function noteControlEdit(): void {
  version++;
}

export function controlEditVersion(): number {
  return version;
}
