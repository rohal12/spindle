import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST, type ASTNode, type MacroNode } from '../../src/markup/ast';

function parse(input: string): ASTNode[] {
  return buildAST(tokenize(input));
}

describe('buildAST', () => {
  describe('flat nodes', () => {
    it('converts text tokens to text nodes', () => {
      const ast = parse('Hello world');
      expect(ast).toEqual([{ type: 'text', value: 'Hello world' }]);
    });

    it('converts link tokens to link nodes', () => {
      const ast = parse('[[Go|Target]]');
      expect(ast).toEqual([{ type: 'link', display: 'Go', target: 'Target' }]);
    });

    it('converts variable tokens to variable nodes', () => {
      const ast = parse('{$health}');
      expect(ast).toEqual([
        { type: 'variable', name: 'health', scope: 'variable' },
      ]);
    });

    it('converts temporary variable tokens', () => {
      const ast = parse('{_temp}');
      expect(ast).toEqual([
        { type: 'variable', name: 'temp', scope: 'temporary' },
      ]);
    });

    it('self-closing macro becomes childless MacroNode', () => {
      const ast = parse('{set $x = 5}');
      expect(ast).toEqual([
        { type: 'macro', name: 'set', rawArgs: '$x = 5', children: [] },
      ]);
    });

    it('print macro is self-closing', () => {
      const ast = parse('{print $x + 1}');
      expect(ast).toEqual([
        { type: 'macro', name: 'print', rawArgs: '$x + 1', children: [] },
      ]);
    });
  });

  describe('block macros', () => {
    it('nests children inside if block', () => {
      const ast = parse('{if $x}hello{/if}');
      expect(ast).toHaveLength(1);
      const node = ast[0] as MacroNode;
      expect(node.type).toBe('macro');
      expect(node.name).toBe('if');
      expect(node.branches).toHaveLength(1);
      expect(node.branches![0].rawArgs).toBe('$x');
      expect(node.branches![0].children).toEqual([
        { type: 'text', value: 'hello' },
      ]);
    });

    it('handles if/else branches', () => {
      const ast = parse('{if $x}yes{else}no{/if}');
      const node = ast[0] as MacroNode;
      expect(node.branches).toHaveLength(2);
      expect(node.branches![0].rawArgs).toBe('$x');
      expect(node.branches![0].children).toEqual([
        { type: 'text', value: 'yes' },
      ]);
      expect(node.branches![1].rawArgs).toBe('');
      expect(node.branches![1].children).toEqual([
        { type: 'text', value: 'no' },
      ]);
    });

    it('handles if/elseif/else branches', () => {
      const ast = parse('{if $a}A{elseif $b}B{else}C{/if}');
      const node = ast[0] as MacroNode;
      expect(node.branches).toHaveLength(3);
      expect(node.branches![0].rawArgs).toBe('$a');
      expect(node.branches![1].rawArgs).toBe('$b');
      expect(node.branches![2].rawArgs).toBe('');
    });

    it('nests children inside for block', () => {
      const ast = parse('{for $item of $list}item{/for}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('for');
      expect(node.rawArgs).toBe('$item of $list');
      expect(node.children).toEqual([{ type: 'text', value: 'item' }]);
    });

    it('nests children inside do block', () => {
      const ast = parse('{do}$x = 5{/do}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('do');
      expect(node.children).toEqual([{ type: 'text', value: '$x = 5' }]);
    });

    it('handles nested block macros', () => {
      const ast = parse('{if $a}{if $b}inner{/if}{/if}');
      const outer = ast[0] as MacroNode;
      expect(outer.branches![0].children).toHaveLength(1);
      const inner = outer.branches![0].children[0] as MacroNode;
      expect(inner.name).toBe('if');
      expect(inner.branches![0].children).toEqual([
        { type: 'text', value: 'inner' },
      ]);
    });

    it('handles block macro with links inside', () => {
      const ast = parse('{if $x}[[Go|Target]]{/if}');
      const node = ast[0] as MacroNode;
      expect(node.branches![0].children).toEqual([
        { type: 'link', display: 'Go', target: 'Target' },
      ]);
    });
  });

  describe('className passthrough', () => {
    it('passes className from link token to link node', () => {
      const ast = parse('[[.fancy Go|Target]]');
      expect(ast).toEqual([
        { type: 'link', display: 'Go', target: 'Target', className: 'fancy' },
      ]);
    });

    it('passes className from variable token to variable node', () => {
      const ast = parse('{.hero-name $name}');
      expect(ast).toEqual([
        {
          type: 'variable',
          name: 'name',
          scope: 'variable',
          className: 'hero-name',
        },
      ]);
    });

    it('passes className to if first branch (not node)', () => {
      const ast = parse('{.highlight if $x}hello{/if}');
      const node = ast[0] as MacroNode;
      expect('className' in node).toBe(false);
      expect(node.branches![0].className).toBe('highlight');
      expect(node.branches![0].children).toEqual([
        { type: 'text', value: 'hello' },
      ]);
    });

    it('passes className to elseif and else branches', () => {
      const ast = parse('{.green if $a}A{.yellow elseif $b}B{.red else}C{/if}');
      const node = ast[0] as MacroNode;
      expect(node.branches![0].className).toBe('green');
      expect(node.branches![1].className).toBe('yellow');
      expect(node.branches![2].className).toBe('red');
    });

    it('branches without className omit the field', () => {
      const ast = parse('{if $a}A{else}B{/if}');
      const node = ast[0] as MacroNode;
      expect('className' in node.branches![0]).toBe(false);
      expect('className' in node.branches![1]).toBe(false);
    });

    it('passes className to non-if block macro node', () => {
      const ast = parse('{.danger button $x}click{/button}');
      const node = ast[0] as MacroNode;
      expect(node.className).toBe('danger');
    });

    it('passes className to self-closing macro node', () => {
      const ast = parse('{.muted print $x + 1}');
      expect(ast).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '$x + 1',
          children: [],
          className: 'muted',
        },
      ]);
    });

    it('nodes without className omit the field', () => {
      const ast = parse('[[Go|Target]]');
      expect('className' in ast[0]).toBe(false);
    });
  });

  describe('id passthrough', () => {
    it('passes id from link token to link node', () => {
      const ast = parse('[[#door Go|Target]]');
      expect(ast).toEqual([
        { type: 'link', display: 'Go', target: 'Target', id: 'door' },
      ]);
    });

    it('passes id from variable token to variable node', () => {
      const ast = parse('{#health $hp}');
      expect(ast).toEqual([
        { type: 'variable', name: 'hp', scope: 'variable', id: 'health' },
      ]);
    });

    it('passes both id and className to link node', () => {
      const ast = parse('[[#door.fancy Go|Target]]');
      expect(ast).toEqual([
        {
          type: 'link',
          display: 'Go',
          target: 'Target',
          className: 'fancy',
          id: 'door',
        },
      ]);
    });

    it('passes id to if first branch (not node)', () => {
      const ast = parse('{#cond if $x}hello{/if}');
      const node = ast[0] as MacroNode;
      expect('id' in node).toBe(false);
      expect(node.branches![0].id).toBe('cond');
    });

    it('passes id to elseif and else branches', () => {
      const ast = parse('{#a if $a}A{#b elseif $b}B{#c else}C{/if}');
      const node = ast[0] as MacroNode;
      expect(node.branches![0].id).toBe('a');
      expect(node.branches![1].id).toBe('b');
      expect(node.branches![2].id).toBe('c');
    });

    it('branches without id omit the field', () => {
      const ast = parse('{if $a}A{else}B{/if}');
      const node = ast[0] as MacroNode;
      expect('id' in node.branches![0]).toBe(false);
      expect('id' in node.branches![1]).toBe(false);
    });

    it('passes id to non-if block macro node', () => {
      const ast = parse('{#btn button $x}click{/button}');
      const node = ast[0] as MacroNode;
      expect(node.id).toBe('btn');
    });

    it('passes id to self-closing macro node', () => {
      const ast = parse('{#output print $x + 1}');
      expect(ast).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '$x + 1',
          children: [],
          id: 'output',
        },
      ]);
    });

    it('nodes without id omit the field', () => {
      const ast = parse('[[Go|Target]]');
      expect('id' in ast[0]).toBe(false);
    });
  });

  describe('new block macros', () => {
    it('nests children inside link block', () => {
      const ast = parse('{link "Click me" "Target"}{set $x = 1}{/link}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('link');
      expect(node.rawArgs).toBe('"Click me" "Target"');
      expect(node.children).toHaveLength(1);
      expect((node.children[0] as MacroNode).name).toBe('set');
    });

    it('nests option children inside listbox block', () => {
      const ast = parse('{listbox "$color"}{option Red}{option Green}{/listbox}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('listbox');
      expect(node.rawArgs).toBe('"$color"');
      expect(node.children).toHaveLength(2);
      expect((node.children[0] as MacroNode).name).toBe('option');
      expect((node.children[0] as MacroNode).rawArgs).toBe('Red');
      expect((node.children[1] as MacroNode).name).toBe('option');
      expect((node.children[1] as MacroNode).rawArgs).toBe('Green');
    });

    it('nests option children inside cycle block', () => {
      const ast = parse('{cycle "$mode"}{option Easy}{option Hard}{/cycle}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('cycle');
      expect(node.rawArgs).toBe('"$mode"');
      expect(node.children).toHaveLength(2);
    });

    it('nests children inside repeat block', () => {
      const ast = parse('{repeat 1s}tick {/repeat}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('repeat');
      expect(node.rawArgs).toBe('1s');
      expect(node.children).toEqual([{ type: 'text', value: 'tick ' }]);
    });

    it('nests children inside type block', () => {
      const ast = parse('{type 50ms}Hello world{/type}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('type');
      expect(node.rawArgs).toBe('50ms');
      expect(node.children).toEqual([{ type: 'text', value: 'Hello world' }]);
    });

    it('nests children inside widget block', () => {
      const ast = parse('{widget "greet"}Hello {$name}{/widget}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('widget');
      expect(node.rawArgs).toBe('"greet"');
      expect(node.children).toHaveLength(2);
    });

    it('passes className to non-branching block macro', () => {
      const ast = parse('{.fancy link "Go" "Target"}actions{/link}');
      const node = ast[0] as MacroNode;
      expect(node.className).toBe('fancy');
    });
  });

  describe('switch/case/default branches', () => {
    it('builds switch with case branches', () => {
      const ast = parse('{switch $x}{case 1}one{case 2}two{/switch}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('switch');
      expect(node.rawArgs).toBe('$x');
      expect(node.branches).toHaveLength(3); // first branch + 2 case branches
      // First branch is the initial branch from rawArgs
      expect(node.branches![0].rawArgs).toBe('$x');
      expect(node.branches![1].rawArgs).toBe('1');
      expect(node.branches![1].children).toEqual([
        { type: 'text', value: 'one' },
      ]);
      expect(node.branches![2].rawArgs).toBe('2');
      expect(node.branches![2].children).toEqual([
        { type: 'text', value: 'two' },
      ]);
    });

    it('builds switch with case and default branches', () => {
      const ast = parse(
        '{switch $x}{case "a"}alpha{case "b"}beta{default}other{/switch}',
      );
      const node = ast[0] as MacroNode;
      // First branch (rawArgs=$x) + case "a" + case "b" + default
      expect(node.branches).toHaveLength(4);
      expect(node.branches![3].rawArgs).toBe('');
      expect(node.branches![3].children).toEqual([
        { type: 'text', value: 'other' },
      ]);
    });

    it('passes className to switch first branch', () => {
      const ast = parse('{.highlight switch $x}{case 1}one{/switch}');
      const node = ast[0] as MacroNode;
      expect('className' in node).toBe(false);
      expect(node.branches![0].className).toBe('highlight');
    });

    it('passes className to case branches', () => {
      const ast = parse('{switch $x}{.red case 1}one{.blue default}other{/switch}');
      const node = ast[0] as MacroNode;
      expect(node.branches![1].className).toBe('red');
      expect(node.branches![2].className).toBe('blue');
    });
  });

  describe('timed/next branches', () => {
    it('builds timed with initial children', () => {
      const ast = parse('{timed 2s}first content{/timed}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('timed');
      expect(node.rawArgs).toBe('2s');
      // Timed is branching: first branch has the initial content
      expect(node.branches).toHaveLength(1);
      expect(node.branches![0].children).toEqual([
        { type: 'text', value: 'first content' },
      ]);
    });

    it('builds timed with next branches', () => {
      const ast = parse('{timed 1s}first{next 2s}second{next 3s}third{/timed}');
      const node = ast[0] as MacroNode;
      expect(node.branches).toHaveLength(3);
      expect(node.branches![0].rawArgs).toBe('1s');
      expect(node.branches![0].children).toEqual([
        { type: 'text', value: 'first' },
      ]);
      expect(node.branches![1].rawArgs).toBe('2s');
      expect(node.branches![1].children).toEqual([
        { type: 'text', value: 'second' },
      ]);
      expect(node.branches![2].rawArgs).toBe('3s');
      expect(node.branches![2].children).toEqual([
        { type: 'text', value: 'third' },
      ]);
    });

    it('passes className to timed first branch', () => {
      const ast = parse('{.reveal timed 1s}content{/timed}');
      const node = ast[0] as MacroNode;
      expect('className' in node).toBe(false);
      expect(node.branches![0].className).toBe('reveal');
    });
  });

  describe('self-closing macros (new)', () => {
    it('include is self-closing', () => {
      const ast = parse('{include "OtherPassage"}');
      expect(ast).toEqual([
        {
          type: 'macro',
          name: 'include',
          rawArgs: '"OtherPassage"',
          children: [],
        },
      ]);
    });

    it('goto is self-closing', () => {
      const ast = parse('{goto "Target"}');
      expect(ast).toEqual([
        { type: 'macro', name: 'goto', rawArgs: '"Target"', children: [] },
      ]);
    });

    it('unset is self-closing', () => {
      const ast = parse('{unset $health}');
      expect(ast).toEqual([
        { type: 'macro', name: 'unset', rawArgs: '$health', children: [] },
      ]);
    });

    it('textbox is self-closing', () => {
      const ast = parse('{textbox "$name" "Enter name"}');
      expect(ast).toEqual([
        {
          type: 'macro',
          name: 'textbox',
          rawArgs: '"$name" "Enter name"',
          children: [],
        },
      ]);
    });

    it('numberbox is self-closing', () => {
      const ast = parse('{numberbox "$age" "Age"}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('numberbox');
    });

    it('textarea is self-closing', () => {
      const ast = parse('{textarea "$bio" "Tell us about yourself"}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('textarea');
    });

    it('checkbox is self-closing', () => {
      const ast = parse('{checkbox "$agree" "I agree"}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('checkbox');
      expect(node.rawArgs).toBe('"$agree" "I agree"');
    });

    it('radiobutton is self-closing', () => {
      const ast = parse('{radiobutton "$color" "red" "Red"}');
      const node = ast[0] as MacroNode;
      expect(node.name).toBe('radiobutton');
      expect(node.rawArgs).toBe('"$color" "red" "Red"');
    });

    it('option is self-closing (inside block parent)', () => {
      const ast = parse('{listbox "$x"}{option A}{/listbox}');
      const listbox = ast[0] as MacroNode;
      expect(listbox.children).toHaveLength(1);
      expect((listbox.children[0] as MacroNode).name).toBe('option');
    });

    it('stop is self-closing (inside repeat)', () => {
      const ast = parse('{repeat 1s}content{stop}{/repeat}');
      const repeat = ast[0] as MacroNode;
      expect(repeat.children).toHaveLength(2);
      expect((repeat.children[1] as MacroNode).name).toBe('stop');
    });
  });

  describe('errors', () => {
    it('throws on unclosed block macro', () => {
      expect(() => parse('{if $x}hello')).toThrow('Unclosed {if} macro');
    });

    it('throws on mismatched close tag', () => {
      expect(() => parse('{if $x}hello{/for}')).toThrow(
        'Expected {/if} but found {/for}',
      );
    });

    it('throws on unexpected close tag', () => {
      expect(() => parse('{/if}')).toThrow('Unexpected closing {/if}');
    });

    it('throws on elseif without if', () => {
      expect(() => parse('{elseif $x}')).toThrow(
        '{elseif} without matching {if}',
      );
    });

    it('throws on else without if', () => {
      expect(() => parse('{else}')).toThrow('{else} without matching {if}');
    });

    it('throws on case without switch', () => {
      expect(() => parse('{case 1}')).toThrow(
        '{case} without matching {switch}',
      );
    });

    it('throws on default without switch', () => {
      expect(() => parse('{default}')).toThrow(
        '{default} without matching {switch}',
      );
    });

    it('throws on next without timed', () => {
      expect(() => parse('{next 1s}')).toThrow(
        '{next} without matching {timed}',
      );
    });

    it('throws on case inside if (wrong parent)', () => {
      expect(() => parse('{if $x}{case 1}{/if}')).toThrow(
        '{case} without matching {switch}',
      );
    });

    it('throws on next inside switch (wrong parent)', () => {
      expect(() => parse('{switch $x}{next 1s}{/switch}')).toThrow(
        '{next} without matching {timed}',
      );
    });

    it('throws on unclosed new block macros', () => {
      expect(() => parse('{link "Go" "Target"}hello')).toThrow(
        'Unclosed {link} macro',
      );
      expect(() => parse('{switch $x}{case 1}one')).toThrow(
        'Unclosed {switch} macro',
      );
      expect(() => parse('{timed 1s}hello')).toThrow(
        'Unclosed {timed} macro',
      );
      expect(() => parse('{repeat 1s}hello')).toThrow(
        'Unclosed {repeat} macro',
      );
      expect(() => parse('{type 50ms}hello')).toThrow(
        'Unclosed {type} macro',
      );
      expect(() => parse('{widget "foo"}hello')).toThrow(
        'Unclosed {widget} macro',
      );
    });

    it('includes position in error for unclosed macro', () => {
      expect(() => parse('abc{if $x}hello')).toThrow('character 3');
    });
  });

  describe('mixed content', () => {
    it('handles complete passage with macros and links', () => {
      const ast = parse('Hello {$name}! {set $seen = true}\n[[Next]]');
      expect(ast.map((n) => n.type)).toEqual([
        'text',
        'variable',
        'text',
        'macro',
        'text',
        'link',
      ]);
    });

    it('handles passage with new macros intermixed', () => {
      const ast = parse(
        '{include "Header"}{textbox "$name" "Name"}{switch $mode}{case "a"}A{default}B{/switch}',
      );
      expect(ast.map((n) => (n as MacroNode).name)).toEqual([
        'include',
        'textbox',
        'switch',
      ]);
    });
  });
});
