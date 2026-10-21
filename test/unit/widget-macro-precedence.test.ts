import { describe, expect, it } from 'vitest';
import { getMacroRegistry } from '../../src/registry';
import {
  passagePieces,
  validateStoryMarkup,
  validateVariableReferences,
  variableReferences,
  type ToolingMacro,
} from '../../src/tooling';
import { parseStoryVariables } from '../../src/story-variables';

const macros = getMacroRegistry();
const caption: ToolingMacro = {
  name: 'caption',
  block: false,
  subMacros: [],
  parameters: [{ name: 'value', type: 'expression' }],
};

describe('widgets shadow macro validation metadata (#618)', () => {
  it.each(['print', 'caption'])(
    'checks a %s widget with its own arguments',
    (name) => {
      const passages = [
        {
          name: 'StoryInit',
          content: `{widget "${name}" @first @second}{@first} {@second}{/widget}`,
        },
        { name: 'Start', content: `{${name.toUpperCase()} "Hello" "world"}` },
      ];
      expect(validateStoryMarkup(passages, [...macros, caption])).toEqual([]);
    },
  );

  it.each([true, false])(
    'prefers widget metadata regardless of iterable order (widget first: %s)',
    (first) => {
      const widget: ToolingMacro = {
        name: 'CAPTION',
        block: false,
        subMacros: [],
        widget: { params: ['@first', '@second'] },
      };
      expect(
        passagePieces(
          '{caption "Hello" "world"}',
          first ? [widget, caption] : [caption, widget],
        ),
      ).toEqual([]);
    },
  );

  it('checks widget holds without applying the macro parameter contract', () => {
    const passages = [
      {
        name: 'StoryInit',
        content: '{widget "print" @first @target:passage}{@first}{/widget}',
      },
      { name: 'Start', content: '{print "Hello" "Missing"}' },
    ];
    expect(validateStoryMarkup(passages, macros)).toMatchObject([
      { code: 'unknown-passage', data: { name: 'Missing' } },
    ]);
  });

  it('does not treat a textbox widget string as a bound variable', () => {
    const passages = [
      {
        name: 'StoryInit',
        content: '{widget "textbox" @label}{@label}{/widget}',
      },
      { name: 'Start', content: '{TEXTBOX "$missing"}' },
    ];
    expect(
      validateVariableReferences(
        passages,
        { variables: parseStoryVariables('') },
        macros,
      ),
    ).toEqual([]);
  });

  it('still reads actual widget argument expressions as variable references', () => {
    const widget: ToolingMacro = {
      name: 'textbox',
      block: false,
      subMacros: [],
      widget: { params: ['@value'] },
    };
    expect(
      variableReferences('{textbox $missing}', [...macros, widget]),
    ).toMatchObject([{ name: 'missing', sigil: '$' }]);
    expect(
      variableReferences('{textbox "$missing"}', [...macros, widget]),
    ).toEqual([]);
  });
});
