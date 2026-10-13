/**
 * Runs the Spindle CodeMirror mode over a passage the way CodeMirror does,
 * line by line with look-ahead, using CodeMirror's own runmode addon.
 */
import { createRequire } from 'node:module';
import type { Mode } from 'codemirror';
import { mode } from '../../src/twine-editor/mode';

interface RunMode {
  defineMode(name: string, factory: () => Mode<unknown>): void;
  runMode(
    text: string,
    mode: string,
    callback: (token: string, style: string | null, line: number) => void,
  ): void;
}

const require = createRequire(import.meta.url);
const CodeMirror =
  require('codemirror/addon/runmode/runmode.node.js') as RunMode;
// As Twine does: the format's `mode` is the factory given to defineMode.
CodeMirror.defineMode('spindle', mode as () => Mode<unknown>);

/** Every token of `text` as [0-based line, token text, style]. */
export function runLines(text: string): [number, string, string | null][] {
  const tokens: [number, string, string | null][] = [];
  CodeMirror.runMode(text, 'spindle', (token, style, line) => {
    // runMode reports each line break as a token without a line number.
    if (token !== '\n' || line !== undefined) tokens.push([line, token, style]);
  });
  return tokens;
}
