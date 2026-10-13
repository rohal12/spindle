import type CodeMirror from 'codemirror';
import * as prettierStandalone from 'prettier/standalone';
import * as babel from 'prettier/plugins/babel';
import * as estree from 'prettier/plugins/estree';
import * as postcss from 'prettier/plugins/postcss';
import * as html from 'prettier/plugins/html';
import {
  formatPassage,
  validateStoryMarkup,
  type PrettierLike,
} from '../tooling';
import { builtinMacros } from './builtin-macros';
import { snippets } from './snippets';

type Editor = CodeMirror.Editor;
type Command = (editor: Editor) => void | Promise<void>;

/** The marker of the cursor slot in a snippet's `before`. */
const SLOT = '|';

/** The most problems Check lists by message. */
const LISTED_PROBLEMS = 5;

/**
 * Standalone Prettier, which takes its parsers from the plugins it is given:
 * every call carries them, whatever options the formatter passes.
 */
const prettier: PrettierLike = {
  format: (code, options) =>
    prettierStandalone.format(code, {
      ...options,
      plugins: [babel, estree, postcss, html],
    }),
};

/**
 * Insert the snippet around every selection, as one undo step. The cursor
 * goes to the slot of each insert; a selection is wrapped, not replaced.
 */
function insertSnippet(editor: Editor, before: string, after: string): void {
  const slot = before.indexOf(SLOT);
  const opening = before.replace(SLOT, '');
  editor.operation(() => {
    editor.replaceSelections(
      editor.getSelections().map((selected) => opening + selected + after),
      'around',
    );
    editor.setSelections(
      editor.listSelections().map((range) => {
        const start = editor.indexFromPos(range.from());
        const cursor = editor.posFromIndex(start + slot);
        return { anchor: cursor, head: cursor };
      }),
    );
  });
}

const snippetCommands = Object.fromEntries(
  snippets.map(({ id, before, after }): [string, Command] => [
    `snippet:${id}`,
    (editor) => insertSnippet(editor, before, after),
  ]),
);

/** The marks of the last Check, which the editor's next change clears. */
const checkMarks = new WeakMap<Editor, CodeMirror.TextMarker[]>();
const watchedForChanges = new WeakSet<Editor>();

function clearCheckMarks(editor: Editor): void {
  for (const mark of checkMarks.get(editor) ?? []) mark.clear();
  checkMarks.delete(editor);
}

/** Mark the span `start`..`end` (offsets) as a problem; an empty span covers a character. */
function markProblem(
  editor: Editor,
  start: number,
  end: number,
  title: string,
): CodeMirror.TextMarker {
  let from = editor.posFromIndex(start);
  let to = editor.posFromIndex(Math.max(end, start + 1));
  // At the very end of the text there is no character after: mark the one before
  if (from.line === to.line && from.ch === to.ch) {
    from = editor.posFromIndex(Math.max(start - 1, 0));
  }
  return editor.markText(from, to, {
    css: 'text-decoration: underline wavy red',
    title,
  });
}

function check(editor: Editor): void {
  clearCheckMarks(editor);
  if (!watchedForChanges.has(editor)) {
    watchedForChanges.add(editor);
    editor.on('change', () => clearCheckMarks(editor));
  }
  const diagnostics = validateStoryMarkup(
    [{ name: 'passage', content: editor.getValue() }],
    builtinMacros,
    { checkPassageNames: false, tolerant: true },
  );
  if (diagnostics.length === 0) {
    window.alert('No problems found');
    return;
  }
  checkMarks.set(
    editor,
    diagnostics.map((d) => markProblem(editor, d.start, d.end, d.message)),
  );
  const listed = diagnostics
    .slice(0, LISTED_PROBLEMS)
    .map((d) => `Line ${d.line}: ${d.message}`);
  const more = diagnostics.length - listed.length;
  const count = `${diagnostics.length} ${diagnostics.length === 1 ? 'problem' : 'problems'} found`;
  window.alert(
    [`${count}:`, ...listed, ...(more > 0 ? [`…and ${more} more`] : [])].join(
      '\n',
    ),
  );
}

async function format(editor: Editor): Promise<void> {
  try {
    const text = editor.getValue();
    const formatted = await formatPassage(text, {
      prettier,
      blockMacros: builtinMacros.filter((m) => m.block).map((m) => m.name),
    });
    // The author kept typing while Prettier ran: their text wins
    if (editor.getValue() !== text || formatted === text) return;
    const cursor = editor.getCursor();
    editor.operation(() => {
      const last = editor.lastLine();
      editor.replaceRange(
        formatted,
        { line: 0, ch: 0 },
        { line: last, ch: editor.getLine(last).length },
      );
      const line = Math.min(cursor.line, editor.lastLine());
      editor.setCursor({
        line,
        ch: Math.min(cursor.ch, editor.getLine(line).length),
      });
    });
  } catch (error) {
    window.alert(error instanceof Error ? error.message : String(error));
  }
}

/** The commands the toolbar runs: `snippet:<id>` for each snippet, `check` and `format`. */
export const commands: Record<string, Command> = {
  ...snippetCommands,
  check,
  format,
};
