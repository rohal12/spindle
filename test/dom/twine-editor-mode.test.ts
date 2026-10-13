// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { runLines } from '../support/twine-editor-mode';

/** The tokens on line `line` (0-based) as [text, style] pairs. */
function lineTokens(text: string, line: number): [string, string | null][] {
  return runLines(text)
    .filter(([n]) => n === line)
    .map(([, token, style]) => [token, style]);
}

describe('Spindle CodeMirror mode', () => {
  it('styles macro arguments that continue on the next line', () => {
    expect(lineTokens('{set $a =\n  1}', 1)).toEqual([
      ['  ', null],
      ['1', 'number'],
      ['}', 'keyword'],
    ]);
  });

  it('styles the first line of a macro by how it closes later', () => {
    expect(lineTokens('{set $a =\n  1}', 0)).toEqual([
      ['{set', 'keyword'],
      [' ', null],
      ['$a', 'variable-2'],
      [' ', null],
      ['=', 'operator'],
    ]);
  });

  it('looks up to 200 lines ahead for a construct to close', () => {
    const args = Array.from({ length: 150 }, () => '  1,');
    const tokens = runLines(['{set $a = [', ...args, ']}'].join('\n'));
    expect(tokens).toContainEqual([0, '{set', 'keyword']);
    expect(tokens).toContainEqual([151, '}', 'keyword']);
  });

  it('treats a construct still open 200 lines on as unclosed', () => {
    const args = Array.from({ length: 300 }, () => '  1,');
    const tokens = runLines(['{set $a = [', ...args, ']}'].join('\n'));
    expect(tokens).toContainEqual([0, '{set $a = [', 'error']);
  });

  it('styles each line of a {do} body as code', () => {
    const tokens = runLines('{do}\n$a = 1;\n_b = "x";\n{/do}');
    expect(tokens).toContainEqual([1, '$a', 'variable-2']);
    expect(tokens).toContainEqual([1, '1', 'number']);
    expect(tokens).toContainEqual([2, '_b', 'variable-3']);
    expect(tokens).toContainEqual([2, '"x"', 'string']);
    expect(tokens).toContainEqual([3, '{/do}', 'keyword']);
  });

  it('styles every line after an unclosed <!-- as a comment', () => {
    const tokens = runLines('a <!-- b\nc\nd');
    expect(tokens.filter(([n]) => n > 0)).toEqual([
      [1, 'c', 'comment'],
      [2, 'd', 'comment'],
    ]);
  });

  it.each(['', '\r\n'])('produces no tokens for %j', (text) => {
    expect(runLines(text)).toEqual([]);
  });

  it('keeps a construct open for thousands of lines fast', () => {
    const text = [
      '{if $x',
      ...Array.from({ length: 4999 }, (_, i) => `line ${i}`),
    ].join('\n');
    const started = performance.now();
    const tokens = runLines(text);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(tokens).toContainEqual([4999, 'line 4998', 'error']);
  });
});
