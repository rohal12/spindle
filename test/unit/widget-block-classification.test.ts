// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { parseMarkup } from '../../src/markup/parse';
import { validateStoryMarkup } from '../../src/tooling';
import { getMacroRegistry } from '../../src/registry';
import {
  isBlockMacro,
  registerBlockMacro,
  unregisterBlockMacro,
  type ASTNode,
} from '../../src/markup/ast';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import {
  registerWidgetDef,
  registerWidgetDefinitions,
} from '../../src/widgets/register-widget-def';
import { clearWidgets, getWidget } from '../../src/widgets/widget-registry';
import {
  blockWidgetNames,
  widgetDefinitions,
} from '../../src/widgets/widget-def';

const NESTED =
  '{widget "outer"}{widget "inner"}{@children}{/widget}Ready{/widget}';

/** The body of the first macro of `markup`. */
function bodyOf(markup: string): ASTNode[] {
  const [node] = parseMarkup(markup);
  return node?.type === 'macro' ? node.children : [];
}

const def = (name: string) => ({ name, params: [] });

afterEach(() => {
  clearWidgets();
  unregisterBlockMacro('auditbox');
});

describe('nested widget definitions own their {@children} (#522)', () => {
  it('the AST scan stops at a nested {widget}', () => {
    expect(astContainsChildren(bodyOf(NESTED))).toBe(false);
  });

  it('still finds a slot beside the nested definition', () => {
    expect(
      astContainsChildren(
        bodyOf(
          '{widget "outer"}{widget "inner"}{@children}{/widget}{@children}{/widget}',
        ),
      ),
    ).toBe(true);
  });

  it('still finds a slot in a rendering macro inside the widget', () => {
    expect(astContainsChildren(parseMarkup('{if true}{@children}{/if}'))).toBe(
      true,
    );
  });

  it('runtime, flat scanner and startup agree: outer is inline', () => {
    registerWidgetDefinitions(parseMarkup(NESTED), 'P');
    expect(getWidget('outer')?.isBlock).toBe(false);
    expect(isBlockMacro('outer')).toBe(false);
    const passages = [{ name: 'StoryInit', content: NESTED }];
    expect(widgetDefinitions(passages).map((d) => [d.name, d.block])).toEqual([
      ['outer', false],
      ['inner', true],
    ]);
    expect(blockWidgetNames(passages)).toEqual(['inner']);
  });
});

describe('a redefined widget follows its latest definition (#523)', () => {
  it('block -> inline drops the parser classification', () => {
    registerWidgetDef(def('auditbox'), parseMarkup('{@children}'));
    expect(isBlockMacro('auditbox')).toBe(true);
    registerWidgetDef(def('auditbox'), parseMarkup('Ready'));
    expect(getWidget('auditbox')?.isBlock).toBe(false);
    expect(isBlockMacro('auditbox')).toBe(false);
    expect(() => parseMarkup('{auditbox}')).not.toThrow();
  });

  it('inline -> block adds it again', () => {
    registerWidgetDef(def('auditbox'), parseMarkup('Ready'));
    registerWidgetDef(def('auditbox'), parseMarkup('{@children}'));
    expect(isBlockMacro('auditbox')).toBe(true);
  });

  it('keeps an independently registered block macro of the same name', () => {
    registerBlockMacro('auditbox');
    registerWidgetDef(def('auditbox'), parseMarkup('Ready'));
    expect(isBlockMacro('auditbox')).toBe(true);
  });

  it('clearing the widgets clears their classification', () => {
    registerWidgetDef(def('auditbox'), parseMarkup('{@children}'));
    clearWidgets();
    expect(isBlockMacro('auditbox')).toBe(false);
  });

  it('startup discovery: the latest definition wins, across passages', () => {
    const blockThenInline = [
      {
        name: 'A',
        tags: ['widget'],
        content: '{widget "box"}{@children}{/widget}',
      },
      { name: 'B', tags: ['widget'], content: '{widget "box"}Ready{/widget}' },
    ];
    expect(blockWidgetNames(blockThenInline)).toEqual([]);
    expect(blockWidgetNames([...blockThenInline].reverse())).toEqual(['box']);
  });

  it('startup discovery: StoryInit registers after the widget passages', () => {
    const passages = [
      { name: 'StoryInit', content: '{widget "box"}Ready{/widget}' },
      {
        name: 'A',
        tags: ['widget'],
        content: '{widget "box"}{@children}{/widget}',
      },
    ];
    expect(blockWidgetNames(passages)).toEqual([]);
  });

  it('startup discovery: the later definition of a passage, any name case', () => {
    const content =
      '{widget "Box"}{@children}{/widget}{widget "box"}Ready{/widget}';
    expect(
      blockWidgetNames([{ name: 'A', tags: ['widget'], content }]),
    ).toEqual([]);
  });
});

describe('tooling reads the same effective definitions', () => {
  const run = (
    passages: { name: string; tags?: string[]; content: string }[],
  ) => validateStoryMarkup(passages, getMacroRegistry()).map((d) => d.message);

  it('a call of a widget that defines a block widget needs no closer (#522)', () => {
    expect(
      run([
        { name: 'StoryInit', content: NESTED },
        { name: 'Start', content: '{outer}' },
      ]),
    ).toEqual([]);
  });

  it('a call of a widget redefined as inline needs no closer (#523)', () => {
    expect(
      run([
        {
          name: 'W',
          tags: ['widget'],
          content: '{widget "box"}{@children}{/widget}',
        },
        { name: 'StoryInit', content: '{widget "box"}Ready{/widget}' },
        { name: 'Start', content: '{box}' },
      ]),
    ).toEqual([]);
  });
});

describe('startup discovers children forwarded through a do widget (#630)', () => {
  const wrap = '{widget "Wrap"}{do}{@children}{/do}{/widget}';
  const doWidget = '{widget "do"}{@children}{/widget}';

  it.each([
    '{button "{do}{@children}{/do}"}Ready{/button}',
    '<span title="{do}{@children}{/do}">Ready</span>',
  ])('finds forwarded children inside nested markup: %s', (body) => {
    const passages = [
      {
        name: 'StoryInit',
        content: `${doWidget}{widget "Wrap"}${body}{/widget}{Wrap}Ready{/Wrap}`,
      },
    ];
    expect(blockWidgetNames(passages)).toEqual(['do', 'Wrap']);
    expect(validateStoryMarkup(passages, getMacroRegistry())).toEqual([]);
  });

  it.each([false, true])(
    'reads either definition order in StoryInit (reverse: %s)',
    (reverse) => {
      const content = (reverse ? [wrap, doWidget] : [doWidget, wrap]).join(
        '\n',
      );
      expect(blockWidgetNames([{ name: 'StoryInit', content }])).toEqual(
        reverse ? ['Wrap', 'do'] : ['do', 'Wrap'],
      );
    },
  );

  it.each([false, true])(
    'reads widget passages in either order (reverse: %s)',
    (reverse) => {
      const passages = [
        { name: 'Wraps', tags: ['widget'], content: wrap },
        { name: 'Do', tags: ['widget'], content: doWidget },
        { name: 'StoryInit', content: '{Wrap}Ready{/Wrap}' },
      ];
      if (reverse) passages.reverse();
      expect(blockWidgetNames(passages).sort()).toEqual(['Wrap', 'do']);
      expect(validateStoryMarkup(passages, getMacroRegistry())).toEqual([]);
    },
  );

  it('keeps widget syntax and children slots in real do strings as JavaScript', () => {
    const content =
      '{widget "Literal"}{do}const fake = \'{widget "do"}{@children}{/widget}\';{/do}Ready{/widget}' +
      wrap;
    expect(
      widgetDefinitions([{ name: 'StoryInit', content }]).map((definition) => [
        definition.name,
        definition.block,
      ]),
    ).toEqual([
      ['Literal', false],
      ['Wrap', false],
    ]);
  });
});
