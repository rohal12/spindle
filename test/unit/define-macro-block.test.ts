import { describe, it, expect, afterEach } from 'vitest';
import { tokenize } from '../../src/markup/tokenizer';
import {
  buildAST,
  registerBlockMacro,
  unregisterBlockMacro,
  type MacroNode,
} from '../../src/markup/ast';
import { defineMacro } from '../../src/define-macro';
import { getMacro, isSubMacro } from '../../src/registry';

function parse(input: string) {
  return buildAST(tokenize(input));
}

describe('registerBlockMacro', () => {
  afterEach(() => {
    unregisterBlockMacro('custom');
    unregisterBlockMacro('choices');
  });

  it('makes the AST builder treat the macro as a block', () => {
    registerBlockMacro('custom');
    const ast = parse('{custom}hello{/custom}');
    expect(ast).toHaveLength(1);
    const node = ast[0] as MacroNode;
    expect(node.type).toBe('macro');
    expect(node.name).toBe('custom');
    expect(node.children).toEqual([{ type: 'text', value: 'hello' }]);
  });

  it('without registration, closing tag throws', () => {
    expect(() => parse('{choices}pick one{/choices}')).toThrow(
      'Unexpected closing {/choices}',
    );
  });
});

describe('defineMacro with block flag', () => {
  afterEach(() => {
    unregisterBlockMacro('panel');
    unregisterBlockMacro('accordion');
    unregisterBlockMacro('choices');
  });

  it('block: true registers the macro as a block macro', () => {
    defineMacro({
      name: 'panel',
      block: true,
      render: () => null,
    });

    expect(getMacro('panel')).toBeDefined();
    const ast = parse('{panel}content{/panel}');
    const node = ast[0] as MacroNode;
    expect(node.name).toBe('panel');
    expect(node.children).toEqual([{ type: 'text', value: 'content' }]);
  });

  it('subMacros implies block registration', () => {
    defineMacro({
      name: 'choices',
      subMacros: ['choice'],
      render: () => null,
    });

    expect(getMacro('choices')).toBeDefined();
    expect(isSubMacro('choice')).toBe(true);
    const ast = parse('{choices}pick{/choices}');
    const node = ast[0] as MacroNode;
    expect(node.name).toBe('choices');
    expect(node.children).toEqual([{ type: 'text', value: 'pick' }]);
  });

  it('subMacros with block: false does NOT register as block', () => {
    defineMacro({
      name: 'accordion',
      subMacros: ['section'],
      block: false,
      render: () => null,
    });

    expect(getMacro('accordion')).toBeDefined();
    expect(isSubMacro('section')).toBe(true);
    // Should be treated as self-closing since block: false
    expect(() => parse('{accordion}content{/accordion}')).toThrow(
      'Unexpected closing {/accordion}',
    );
  });
});
