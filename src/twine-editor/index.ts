import { mode } from './mode';
import { toolbar } from './toolbar';
import { commands } from './commands';
import { parsePassageText } from './references';

/**
 * What the format's `hydrate` hands Twine 2.4+: the passage editor's
 * CodeMirror mode, toolbar and commands, and the passage references Twine
 * draws as connections. Twine ignores `hydrate` when it compiles a story, so
 * none of this reaches a published story.
 */
export const editorExtensions = {
  twine: {
    '^2.4.0': {
      codeMirror: { mode, toolbar, commands },
      references: { parsePassageText },
    },
  },
};
