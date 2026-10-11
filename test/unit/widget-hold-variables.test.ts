/**
 * Variable references in widget arguments that hold code or markup (#496).
 */
import { describe, it, expect } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  parseDeclarations,
  validateVariableReferences,
  variableReferences,
  type ToolingMacro,
} from '../../src/tooling';

const macros = getMacroRegistry();
/** The start of a JavaScript unicode escape, written out. */
const U = '\\' + 'u';

const declare = (variables: string) => ({
  variables: new Map(
    parseDeclarations(variables).declarations.map((d) => [d.name, d.schema]),
  ),
});

const widget = (
  holds: Record<string, 'expression' | 'statements' | 'markup' | 'passage'>,
  params = Object.keys(holds),
): ToolingMacro => ({
  name: 'w',
  block: false,
  subMacros: [],
  widget: { params, holds },
});

describe('widget parameters that hold code or markup (#496)', () => {
  const missing = (source: string, macro = widget({ '@code': 'statements' })) =>
    validateVariableReferences(
      [{ name: 'Start', content: source }],
      { variables: new Map() },
      [macro],
    );

  it('finds the references in a statements hold', () => {
    const source = '{w "$missing = 1"}';
    const refs = variableReferences(source, [
      widget({ '@code': 'statements' }),
    ]);
    expect(refs.map((r) => [r.name, source.slice(r.start, r.end)])).toEqual([
      ['missing', '$missing'],
    ]);
    expect(missing(source)).toMatchObject([
      { code: 'undeclared-variable', name: 'missing', start: 4, end: 12 },
    ]);
  });

  it('finds them in an expression hold, by position', () => {
    const macro = widget({ '@a': 'expression' }, ['@x', '@a']);
    const source = '{w "$x" "$y + 1"}';
    expect(missing(source, macro).map((d) => d.name)).toEqual(['y']);
  });

  it('finds them in a markup hold, and ignores text and passage holds', () => {
    const markup = widget({ '@m': 'markup' });
    expect(missing('{w "Hi {$who}"}', markup).map((d) => d.name)).toEqual([
      'who',
    ]);
    expect(missing('{w "Hi $who"}', markup)).toEqual([]);
    expect(missing('{w "$p"}', widget({ '@t': 'passage' }))).toEqual([]);
  });

  it('maps references after escapes in the hold', () => {
    const source = String.raw`{w "${U}0031; $missing"}`;
    const [d] = missing(source, widget({ '@code': 'statements' }));
    expect(source.slice(d!.start, d!.end)).toBe('$missing');
  });

  it('places the references of a markup hold after escapes', () => {
    const source = String.raw`{w "${U}0041 {$x}"}`;
    const refs = variableReferences(source, [widget({ '@m': 'markup' })]);
    expect(refs.map((r) => source.slice(r.start, r.end))).toEqual(['$x']);
  });

  it('is complete with all, and in source order', () => {
    const source = '{w "$b = 1"}{.{$c} w "$a = 2"}';
    const refs = variableReferences(
      source,
      [widget({ '@code': 'statements' })],
      { all: true },
    );
    expect(refs.map((r) => r.name)).toEqual(['b', 'c', 'a']);
  });

  it('reads the widgets that the passages define, as the story start does', () => {
    const passages = [
      {
        name: 'Widgets',
        tags: ['widget'],
        content: '{widget "run" @code:statements}{@code}{/widget}',
      },
      { name: 'Start', content: '{run "$missing = 1"}' },
    ];
    expect(
      validateVariableReferences(
        passages,
        { variables: new Map() },
        macros,
      ).map((d) => [d.passage, d.name]),
    ).toEqual([['Start', 'missing']]);
  });

  it('reports nothing for a variable that is declared', () => {
    expect(
      validateVariableReferences(
        [{ name: 'Start', content: '{w "$a = 1"}' }],
        declare('$a = 0'),
        [widget({ '@code': 'statements' })],
      ),
    ).toEqual([]);
  });
});
