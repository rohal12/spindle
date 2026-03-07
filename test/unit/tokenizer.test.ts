import { describe, it, expect } from 'vitest';
import { tokenize } from '../../src/markup/tokenizer';

describe('tokenize', () => {
  describe('text', () => {
    it('returns a single text token for plain text', () => {
      const tokens = tokenize('Hello world');
      expect(tokens).toEqual([
        { type: 'text', value: 'Hello world', start: 0, end: 11 },
      ]);
    });

    it('returns empty array for empty string', () => {
      expect(tokenize('')).toEqual([]);
    });
  });

  describe('links', () => {
    it('parses [[passage]] as plain link', () => {
      const tokens = tokenize('[[Garden]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Garden',
          target: 'Garden',
          start: 0,
          end: 10,
        },
      ]);
    });

    it('parses [[display|target]] pipe syntax', () => {
      const tokens = tokenize('[[Go|Garden]]');
      expect(tokens).toEqual([
        { type: 'link', display: 'Go', target: 'Garden', start: 0, end: 13 },
      ]);
    });

    it('parses [[display->target]] arrow syntax', () => {
      const tokens = tokenize('[[Go->Garden]]');
      expect(tokens).toEqual([
        { type: 'link', display: 'Go', target: 'Garden', start: 0, end: 14 },
      ]);
    });

    it('parses [[target<-display]] reverse arrow syntax', () => {
      const tokens = tokenize('[[Garden<-Go]]');
      expect(tokens).toEqual([
        { type: 'link', display: 'Go', target: 'Garden', start: 0, end: 14 },
      ]);
    });

    it('trims whitespace in link parts', () => {
      const tokens = tokenize('[[  display  |  target  ]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'display',
          target: 'target',
          start: 0,
          end: 26,
        },
      ]);
    });

    it('handles multiple links with text between', () => {
      const tokens = tokenize('Go [[Left]] or [[Right]]');
      expect(tokens).toHaveLength(4);
      expect(tokens[0]).toEqual({
        type: 'text',
        value: 'Go ',
        start: 0,
        end: 3,
      });
      expect(tokens[1]).toEqual({
        type: 'link',
        display: 'Left',
        target: 'Left',
        start: 3,
        end: 11,
      });
      expect(tokens[2]).toEqual({
        type: 'text',
        value: ' or ',
        start: 11,
        end: 15,
      });
      expect(tokens[3]).toEqual({
        type: 'link',
        display: 'Right',
        target: 'Right',
        start: 15,
        end: 24,
      });
    });

    it('handles all four syntaxes in the same content', () => {
      const tokens = tokenize('[[plain]] [[d|t]] [[d->t]] [[t<-d]]');
      const links = tokens.filter((t) => t.type === 'link');
      expect(links).toHaveLength(4);
      expect(
        links.map((l) => ({ d: (l as any).display, t: (l as any).target })),
      ).toEqual([
        { d: 'plain', t: 'plain' },
        { d: 'd', t: 't' },
        { d: 'd', t: 't' },
        { d: 'd', t: 't' },
      ]);
    });

    it('treats unclosed [[ as text', () => {
      const tokens = tokenize('[[unclosed');
      expect(tokens).toEqual([
        { type: 'text', value: '[[unclosed', start: 0, end: 10 },
      ]);
    });
  });

  describe('variables', () => {
    it('parses {$var} as variable token', () => {
      const tokens = tokenize('{$health}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'health',
          scope: 'variable',
          start: 0,
          end: 9,
        },
      ]);
    });

    it('parses {_temp} as temporary variable token', () => {
      const tokens = tokenize('{_count}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'count',
          scope: 'temporary',
          start: 0,
          end: 8,
        },
      ]);
    });

    it('handles variable in text', () => {
      const tokens = tokenize('Health: {$health} points');
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toEqual({
        type: 'text',
        value: 'Health: ',
        start: 0,
        end: 8,
      });
      expect(tokens[1]).toEqual({
        type: 'variable',
        name: 'health',
        scope: 'variable',
        start: 8,
        end: 17,
      });
      expect(tokens[2]).toEqual({
        type: 'text',
        value: ' points',
        start: 17,
        end: 24,
      });
    });

    it('handles multiple variables', () => {
      const tokens = tokenize('{$a} and {_b}');
      const vars = tokens.filter((t) => t.type === 'variable');
      expect(vars).toHaveLength(2);
    });

    it('parses {@local} as local variable token', () => {
      const tokens = tokenize('{@item}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'item',
          scope: 'local',
          start: 0,
          end: 7,
        },
      ]);
    });

    it('parses {@local.field} with dot path', () => {
      const tokens = tokenize('{@player.name}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'player.name',
          scope: 'local',
          start: 0,
          end: 14,
        },
      ]);
    });

    it('handles @ local in text', () => {
      const tokens = tokenize('Item: {@item} here');
      expect(tokens).toHaveLength(3);
      expect(tokens[1]).toEqual({
        type: 'variable',
        name: 'item',
        scope: 'local',
        start: 6,
        end: 13,
      });
    });

    it('handles mixed $, _, and @ variables', () => {
      const tokens = tokenize('{$a} {@b} {_c}');
      const vars = tokens.filter((t) => t.type === 'variable');
      expect(vars).toHaveLength(3);
      expect(vars[0]).toMatchObject({ scope: 'variable', name: 'a' });
      expect(vars[1]).toMatchObject({ scope: 'local', name: 'b' });
      expect(vars[2]).toMatchObject({ scope: 'temporary', name: 'c' });
    });

    it('parses {.class @local} with selector prefix', () => {
      const tokens = tokenize('{.highlight @item}');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'variable',
        name: 'item',
        scope: 'local',
        className: 'highlight',
      });
    });
  });

  describe('macros', () => {
    it('parses {set $x = 5} as macro token', () => {
      const tokens = tokenize('{set $x = 5}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'set',
          rawArgs: '$x = 5',
          isClose: false,
          start: 0,
          end: 12,
        },
      ]);
    });

    it('parses {/if} as closing macro token', () => {
      const tokens = tokenize('{/if}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'if',
          rawArgs: '',
          isClose: true,
          start: 0,
          end: 5,
        },
      ]);
    });

    it('parses {else} as a macro', () => {
      const tokens = tokenize('{else}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'else',
          rawArgs: '',
          isClose: false,
          start: 0,
          end: 6,
        },
      ]);
    });

    it('parses {elseif $x > 3} with args', () => {
      const tokens = tokenize('{elseif $x > 3}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'elseif',
          rawArgs: '$x > 3',
          isClose: false,
          start: 0,
          end: 15,
        },
      ]);
    });

    it('parses {print $health * 2}', () => {
      const tokens = tokenize('{print $health * 2}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '$health * 2',
          isClose: false,
          start: 0,
          end: 19,
        },
      ]);
    });

    it('handles brace nesting: {set $obj = {a: 1}}', () => {
      const tokens = tokenize('{set $obj = {a: 1}}');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'macro',
        name: 'set',
        rawArgs: '$obj = {a: 1}',
      });
    });

    it('parses {for $item, $i of $list}', () => {
      const tokens = tokenize('{for $item, $i of $list}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'for',
          rawArgs: '$item, $i of $list',
          isClose: false,
          start: 0,
          end: 24,
        },
      ]);
    });

    it('treats bare { as text', () => {
      const tokens = tokenize('a { b');
      expect(tokens).toEqual([
        { type: 'text', value: 'a { b', start: 0, end: 5 },
      ]);
    });

    it('treats {123} as text (not a macro)', () => {
      const tokens = tokenize('{123}');
      expect(tokens).toEqual([
        { type: 'text', value: '{123}', start: 0, end: 5 },
      ]);
    });
  });

  describe('CSS class syntax', () => {
    it('parses {.class $var} as variable with className', () => {
      const tokens = tokenize('{.hero-name $name}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'name',
          scope: 'variable',
          className: 'hero-name',
          start: 0,
          end: 18,
        },
      ]);
    });

    it('parses {.class _temp} as temporary variable with className', () => {
      const tokens = tokenize('{.muted _count}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'count',
          scope: 'temporary',
          className: 'muted',
          start: 0,
          end: 15,
        },
      ]);
    });

    it('parses multiple classes on variable: {.foo.bar $var}', () => {
      const tokens = tokenize('{.foo.bar $name}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'name',
          scope: 'variable',
          className: 'foo bar',
          start: 0,
          end: 16,
        },
      ]);
    });

    it('parses {.class macroName args} as macro with className', () => {
      const tokens = tokenize('{.danger button $health -= 10}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'button',
          rawArgs: '$health -= 10',
          isClose: false,
          className: 'danger',
          start: 0,
          end: 30,
        },
      ]);
    });

    it('parses multiple classes on macro: {.danger.large button ...}', () => {
      const tokens = tokenize('{.danger.large button $health -= 10}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'button',
          rawArgs: '$health -= 10',
          isClose: false,
          className: 'danger large',
          start: 0,
          end: 36,
        },
      ]);
    });

    it('parses {.class if $cond} as macro with className', () => {
      const tokens = tokenize('{.highlight if $health < 50}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'if',
          rawArgs: '$health < 50',
          isClose: false,
          className: 'highlight',
          start: 0,
          end: 28,
        },
      ]);
    });

    it('parses {.class print expr} as macro with className', () => {
      const tokens = tokenize('{.muted print $visited_rooms}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '$visited_rooms',
          isClose: false,
          className: 'muted',
          start: 0,
          end: 29,
        },
      ]);
    });

    it('parses {.class elseif $cond} as macro with className', () => {
      const tokens = tokenize('{.red elseif $health < 50}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'elseif',
          rawArgs: '$health < 50',
          isClose: false,
          className: 'red',
          start: 0,
          end: 26,
        },
      ]);
    });

    it('parses {.class else} as macro with className', () => {
      const tokens = tokenize('{.red else}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'else',
          rawArgs: '',
          isClose: false,
          className: 'red',
          start: 0,
          end: 11,
        },
      ]);
    });

    it('closing tags do not take classes', () => {
      const tokens = tokenize('{/button}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'button',
          rawArgs: '',
          isClose: true,
          start: 0,
          end: 9,
        },
      ]);
    });

    it('parses [[.class link]] with className', () => {
      const tokens = tokenize('[[.fancy Open the door|Hallway]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Open the door',
          target: 'Hallway',
          className: 'fancy',
          start: 0,
          end: 32,
        },
      ]);
    });

    it('parses [[.class.class2 link]] with multiple classes', () => {
      const tokens = tokenize('[[.fancy.bold Go|Start]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Go',
          target: 'Start',
          className: 'fancy bold',
          start: 0,
          end: 24,
        },
      ]);
    });

    it('parses [[.class plain]] plain link with className', () => {
      const tokens = tokenize('[[.fancy Garden]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Garden',
          target: 'Garden',
          className: 'fancy',
          start: 0,
          end: 17,
        },
      ]);
    });

    it('tokens without classes have no className property', () => {
      const tokens = tokenize('{$name}');
      expect(tokens[0]).toEqual({
        type: 'variable',
        name: 'name',
        scope: 'variable',
        start: 0,
        end: 7,
      });
      expect('className' in tokens[0]).toBe(false);
    });

    it('link tokens without classes have no className property', () => {
      const tokens = tokenize('[[Go|Start]]');
      expect('className' in tokens[0]).toBe(false);
    });

    it('macro tokens without classes have no className property', () => {
      const tokens = tokenize('{set $x = 5}');
      expect('className' in tokens[0]).toBe(false);
    });

    it('tokens without id have no id property', () => {
      const tokens = tokenize('{$name}');
      expect('id' in tokens[0]).toBe(false);
    });

    it('link tokens without id have no id property', () => {
      const tokens = tokenize('[[Go|Start]]');
      expect('id' in tokens[0]).toBe(false);
    });

    it('macro tokens without id have no id property', () => {
      const tokens = tokenize('{set $x = 5}');
      expect('id' in tokens[0]).toBe(false);
    });
  });

  describe('#id syntax', () => {
    it('parses {#id $var} as variable with id', () => {
      const tokens = tokenize('{#health $hp}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'hp',
          scope: 'variable',
          id: 'health',
          start: 0,
          end: 13,
        },
      ]);
    });

    it('parses {#id _temp} as temporary variable with id', () => {
      const tokens = tokenize('{#counter _count}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'count',
          scope: 'temporary',
          id: 'counter',
          start: 0,
          end: 17,
        },
      ]);
    });

    it('parses {#id macroName args} as macro with id', () => {
      const tokens = tokenize('{#charselect button $choice = 1}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'button',
          rawArgs: '$choice = 1',
          isClose: false,
          id: 'charselect',
          start: 0,
          end: 32,
        },
      ]);
    });

    it('parses [[#id link]] with id', () => {
      const tokens = tokenize('[[#door-link Open the door|Hallway]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Open the door',
          target: 'Hallway',
          id: 'door-link',
          start: 0,
          end: 36,
        },
      ]);
    });

    it('parses [[#id plain]] plain link with id', () => {
      const tokens = tokenize('[[#main-link Garden]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Garden',
          target: 'Garden',
          id: 'main-link',
          start: 0,
          end: 21,
        },
      ]);
    });

    it('parses {#id.class $var} — id then class', () => {
      const tokens = tokenize('{#myid.myclass $name}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'name',
          scope: 'variable',
          className: 'myclass',
          id: 'myid',
          start: 0,
          end: 21,
        },
      ]);
    });

    it('parses {.class#id $var} — class then id', () => {
      const tokens = tokenize('{.myclass#myid $name}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'name',
          scope: 'variable',
          className: 'myclass',
          id: 'myid',
          start: 0,
          end: 21,
        },
      ]);
    });

    it('parses {#id.class1.class2 button args} — id with multiple classes', () => {
      const tokens = tokenize('{#btn.danger.large button $x}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'button',
          rawArgs: '$x',
          isClose: false,
          className: 'danger large',
          id: 'btn',
          start: 0,
          end: 29,
        },
      ]);
    });

    it('parses {.class1#id.class2 macroName} — mixed order', () => {
      const tokens = tokenize('{.foo#bar.baz print $x}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '$x',
          isClose: false,
          className: 'foo baz',
          id: 'bar',
          start: 0,
          end: 23,
        },
      ]);
    });

    it('parses [[#id.class link]] — id and class on link', () => {
      const tokens = tokenize('[[#door.fancy Go|Hallway]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Go',
          target: 'Hallway',
          className: 'fancy',
          id: 'door',
          start: 0,
          end: 26,
        },
      ]);
    });

    it('parses [[.class#id link]] — class then id on link', () => {
      const tokens = tokenize('[[.fancy#door Go|Hallway]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Go',
          target: 'Hallway',
          className: 'fancy',
          id: 'door',
          start: 0,
          end: 26,
        },
      ]);
    });

    it('last #id wins when multiple specified', () => {
      const tokens = tokenize('{#first#second $name}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'name',
          scope: 'variable',
          id: 'second',
          start: 0,
          end: 21,
        },
      ]);
    });
  });

  describe('mixed content', () => {
    it('handles text, variables, links, and macros together', () => {
      const input = 'Hello {$name}! {set $seen = true}Go to [[Next]]';
      const tokens = tokenize(input);
      expect(tokens.map((t) => t.type)).toEqual([
        'text',
        'variable',
        'text',
        'macro',
        'text',
        'link',
      ]);
    });

    it('handles if/else block tokens', () => {
      const tokens = tokenize('{if $x}yes{else}no{/if}');
      expect(tokens.map((t) => t.type)).toEqual([
        'macro',
        'text',
        'macro',
        'text',
        'macro',
      ]);
      expect((tokens[0] as any).name).toBe('if');
      expect((tokens[2] as any).name).toBe('else');
      expect((tokens[4] as any).name).toBe('if');
      expect((tokens[4] as any).isClose).toBe(true);
    });
  });
});
