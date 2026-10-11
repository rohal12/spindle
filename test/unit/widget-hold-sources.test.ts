/**
 * Source offsets in widget arguments through string escapes (#501).
 */
import { describe, it, expect } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  passagePieces,
  validateStoryMarkup,
  type ToolingMacro,
} from '../../src/tooling';

const macros = getMacroRegistry();
/** The start of a JavaScript unicode escape, written out. */
const U = '\\' + 'u';

const widget = (
  holds: Record<string, 'expression' | 'statements' | 'markup' | 'passage'>,
  params = Object.keys(holds),
): ToolingMacro => ({
  name: 'w',
  block: false,
  subMacros: [],
  widget: { params, holds },
});

describe('widget code offsets through JavaScript escapes (#501)', () => {
  const widgets = [...macros, widget({ '@code': 'expression' })];

  it('points a syntax error after \\u at the right character', () => {
    const source = String.raw`{w "${U}0031 + )"}`;
    const [d] = validateStoryMarkup(
      [{ name: 'Start', content: source }],
      widgets,
    );
    expect(d).toMatchObject({ start: 13, end: 14, column: 14 });
    expect(source[13]).toBe(')');
  });

  it('maps every JavaScript escape back to its sequence', () => {
    const source = String.raw`{w "\x31\n+ \u{31}\040+ )"}`;
    const [d] = validateStoryMarkup(
      [{ name: 'Start', content: source }],
      widgets,
    );
    expect(source.slice(d!.start, d!.end)).toBe(')');
  });

  it('keeps the offsets of the escaped quotes of a macro text parameter', () => {
    const source = String.raw`{button "a \"b\" {$x +}"}x{/button}`;
    const [d] = validateStoryMarkup(
      [{ name: 'Start', content: source }],
      macros,
    );
    expect(d!.start).toBe(source.indexOf('+}') + 1);
  });

  it('does not decode other escapes of a macro text parameter', () => {
    // `\n` stays a backslash and an n in a macro's text: one character each
    const source = String.raw`{button "\n {$x +}"}x{/button}`;
    const [d] = validateStoryMarkup(
      [{ name: 'Start', content: source }],
      macros,
    );
    expect(d!.start).toBe(source.indexOf('+}') + 1);
  });

  it('places the markup of a markup hold after escapes', () => {
    const markup = widget({ '@m': 'markup' });
    const source = String.raw`{w "${U}0041 {$x + 1}"}`;
    const code = passagePieces(source, [markup]).find((p) => p.kind === 'code');
    expect(code).toMatchObject({ code: '$x + 1', nested: true });
    expect(code!.offset).toBe(source.indexOf('$x'));
  });
});
