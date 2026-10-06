import { describe, it, expect } from 'vitest';
import { tokenizeMarkup } from '../../src/markup/parse';

describe('tokenizeMarkup', () => {
  describe('text', () => {
    it('returns a single text token for plain text', () => {
      const tokens = tokenizeMarkup('Hello world');
      expect(tokens).toEqual([
        { type: 'text', value: 'Hello world', start: 0, end: 11 },
      ]);
    });

    it('returns empty array for empty string', () => {
      expect(tokenizeMarkup('')).toEqual([]);
    });
  });

  describe('links', () => {
    it('parses [[passage]] as plain link', () => {
      const tokens = tokenizeMarkup('[[Garden]]');
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
      const tokens = tokenizeMarkup('[[Go|Garden]]');
      expect(tokens).toEqual([
        { type: 'link', display: 'Go', target: 'Garden', start: 0, end: 13 },
      ]);
    });

    it('parses [[display->target]] arrow syntax', () => {
      const tokens = tokenizeMarkup('[[Go->Garden]]');
      expect(tokens).toEqual([
        { type: 'link', display: 'Go', target: 'Garden', start: 0, end: 14 },
      ]);
    });

    it('parses [[target<-display]] reverse arrow syntax', () => {
      const tokens = tokenizeMarkup('[[Garden<-Go]]');
      expect(tokens).toEqual([
        { type: 'link', display: 'Go', target: 'Garden', start: 0, end: 14 },
      ]);
    });

    it('trims whitespace in link parts', () => {
      const tokens = tokenizeMarkup('[[  display  |  target  ]]');
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
      const tokens = tokenizeMarkup('Go [[Left]] or [[Right]]');
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
      const tokens = tokenizeMarkup('[[plain]] [[d|t]] [[d->t]] [[t<-d]]');
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

    it('reports an unclosed [[', () => {
      expect(() => tokenizeMarkup('Go\n  [[unclosed')).toThrow(
        expect.objectContaining({
          reason: 'Unclosed link: [[ without ]]',
          line: 2,
          column: 3,
        }),
      );
    });

    it("ends a link at the first ]], so its text can't hold [[", () => {
      expect(() => tokenizeMarkup('[[a [[b]] c]]')).toThrow(
        expect.objectContaining({ reason: 'Unclosed link: [[ without ]]' }),
      );
    });
  });

  describe('variables', () => {
    it('parses {$var} as variable token', () => {
      const tokens = tokenizeMarkup('{$health}');
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
      const tokens = tokenizeMarkup('{_count}');
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
      const tokens = tokenizeMarkup('Health: {$health} points');
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
      const tokens = tokenizeMarkup('{$a} and {_b}');
      const vars = tokens.filter((t) => t.type === 'variable');
      expect(vars).toHaveLength(2);
    });

    it('parses {@local} as local variable token', () => {
      const tokens = tokenizeMarkup('{@item}');
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
      const tokens = tokenizeMarkup('{@player.name}');
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
      const tokens = tokenizeMarkup('Item: {@item} here');
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
      const tokens = tokenizeMarkup('{$a} {@b} {_c}');
      const vars = tokens.filter((t) => t.type === 'variable');
      expect(vars).toHaveLength(3);
      expect(vars[0]).toMatchObject({ scope: 'variable', name: 'a' });
      expect(vars[1]).toMatchObject({ scope: 'local', name: 'b' });
      expect(vars[2]).toMatchObject({ scope: 'temporary', name: 'c' });
    });

    it('parses {.class @local} with selector prefix', () => {
      const tokens = tokenizeMarkup('{.highlight @item}');
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
      const tokens = tokenizeMarkup('{set $x = 5}');
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
      const tokens = tokenizeMarkup('{/if}');
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
      const tokens = tokenizeMarkup('{else}');
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
      const tokens = tokenizeMarkup('{elseif $x > 3}');
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
      const tokens = tokenizeMarkup('{print $health * 2}');
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
      const tokens = tokenizeMarkup('{set $obj = {a: 1}}');
      expect(tokens).toHaveLength(1);
      expect(tokens[0]).toMatchObject({
        type: 'macro',
        name: 'set',
        rawArgs: '$obj = {a: 1}',
      });
    });

    it('parses {for $item, $i of $list}', () => {
      const tokens = tokenizeMarkup('{for $item, $i of $list}');
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
      const tokens = tokenizeMarkup('a { b');
      expect(tokens).toEqual([
        { type: 'text', value: 'a { b', start: 0, end: 5 },
      ]);
    });

    it('treats {123} as text (not a macro)', () => {
      const tokens = tokenizeMarkup('{123}');
      expect(tokens).toEqual([
        { type: 'text', value: '{123}', start: 0, end: 5 },
      ]);
    });
  });

  describe('CSS class syntax', () => {
    it('parses {.class $var} as variable with className', () => {
      const tokens = tokenizeMarkup('{.hero-name $name}');
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
      const tokens = tokenizeMarkup('{.muted _count}');
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
      const tokens = tokenizeMarkup('{.foo.bar $name}');
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
      const tokens = tokenizeMarkup('{.danger button $health -= 10}');
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
      const tokens = tokenizeMarkup('{.danger.large button $health -= 10}');
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
      const tokens = tokenizeMarkup('{.highlight if $health < 50}');
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
      const tokens = tokenizeMarkup('{.muted print $visited_rooms}');
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
      const tokens = tokenizeMarkup('{.red elseif $health < 50}');
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
      const tokens = tokenizeMarkup('{.red else}');
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

    it('parses .{$theme} selector with interpolation', () => {
      const tokens = tokenizeMarkup('{.{$theme} print "hello"}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '"hello"',
          isClose: false,
          className: '{$theme}',
          start: 0,
          end: 25,
        },
      ]);
    });

    it('parses .{$theme}-dark selector — interpolation with suffix', () => {
      const tokens = tokenizeMarkup('{.{$theme}-dark print "hi"}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '"hi"',
          isClose: false,
          className: '{$theme}-dark',
          start: 0,
          end: 27,
        },
      ]);
    });

    it('parses .static.{$dynamic} — mixed static and interpolated classes', () => {
      const tokens = tokenizeMarkup('{.static.{$dynamic} print "x"}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '"x"',
          isClose: false,
          className: 'static {$dynamic}',
          start: 0,
          end: 30,
        },
      ]);
    });

    it('parses #{$pageId} selector with interpolation on id', () => {
      const tokens = tokenizeMarkup('{#{$pageId} print "x"}');
      expect(tokens).toEqual([
        {
          type: 'macro',
          name: 'print',
          rawArgs: '"x"',
          isClose: false,
          id: '{$pageId}',
          start: 0,
          end: 22,
        },
      ]);
    });

    it('parses .{_temp} selector with temporary var interpolation', () => {
      const tokens = tokenizeMarkup('{.{_cls} $name}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'name',
          scope: 'variable',
          className: '{_cls}',
          start: 0,
          end: 15,
        },
      ]);
    });

    it('parses .{@local} selector with local var interpolation', () => {
      const tokens = tokenizeMarkup('{.{@cls} $name}');
      expect(tokens).toEqual([
        {
          type: 'variable',
          name: 'name',
          scope: 'variable',
          className: '{@cls}',
          start: 0,
          end: 15,
        },
      ]);
    });

    it('parses .{%transient} selector with transient var interpolation', () => {
      // Found by property testing: selectors accepted {$ {_ {@ but not {%.
      expect(tokenizeMarkup('{.a-{%_}.a $A}')).toEqual([
        {
          type: 'variable',
          name: 'A',
          scope: 'variable',
          className: 'a-{%_} a',
          start: 0,
          end: 14,
        },
      ]);
      expect(tokenizeMarkup('[[.a-{%a}.a a]]')).toEqual([
        {
          type: 'link',
          display: 'a',
          target: 'a',
          className: 'a-{%a} a',
          start: 0,
          end: 15,
        },
      ]);
    });

    it('parses [[.{$cls} link]] with interpolation in link selector', () => {
      const tokens = tokenizeMarkup('[[.{$cls} Go|Start]]');
      expect(tokens).toEqual([
        {
          type: 'link',
          display: 'Go',
          target: 'Start',
          className: '{$cls}',
          start: 0,
          end: 20,
        },
      ]);
    });

    it('closing tags do not take classes', () => {
      const tokens = tokenizeMarkup('{/button}');
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
      const tokens = tokenizeMarkup('[[.fancy Open the door|Hallway]]');
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
      const tokens = tokenizeMarkup('[[.fancy.bold Go|Start]]');
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
      const tokens = tokenizeMarkup('[[.fancy Garden]]');
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
      const tokens = tokenizeMarkup('{$name}');
      expect(tokens[0]).toEqual({
        type: 'variable',
        name: 'name',
        scope: 'variable',
        start: 0,
        end: 7,
      });
      expect('className' in tokens[0]!).toBe(false);
    });

    it('link tokens without classes have no className property', () => {
      const tokens = tokenizeMarkup('[[Go|Start]]');
      expect('className' in tokens[0]!).toBe(false);
    });

    it('macro tokens without classes have no className property', () => {
      const tokens = tokenizeMarkup('{set $x = 5}');
      expect('className' in tokens[0]!).toBe(false);
    });

    it('tokens without id have no id property', () => {
      const tokens = tokenizeMarkup('{$name}');
      expect('id' in tokens[0]!).toBe(false);
    });

    it('link tokens without id have no id property', () => {
      const tokens = tokenizeMarkup('[[Go|Start]]');
      expect('id' in tokens[0]!).toBe(false);
    });

    it('macro tokens without id have no id property', () => {
      const tokens = tokenizeMarkup('{set $x = 5}');
      expect('id' in tokens[0]!).toBe(false);
    });
  });

  describe('#id syntax', () => {
    it('parses {#id $var} as variable with id', () => {
      const tokens = tokenizeMarkup('{#health $hp}');
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
      const tokens = tokenizeMarkup('{#counter _count}');
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
      const tokens = tokenizeMarkup('{#charselect button $choice = 1}');
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
      const tokens = tokenizeMarkup('[[#door-link Open the door|Hallway]]');
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
      const tokens = tokenizeMarkup('[[#main-link Garden]]');
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
      const tokens = tokenizeMarkup('{#myid.myclass $name}');
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
      const tokens = tokenizeMarkup('{.myclass#myid $name}');
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
      const tokens = tokenizeMarkup('{#btn.danger.large button $x}');
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
      const tokens = tokenizeMarkup('{.foo#bar.baz print $x}');
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
      const tokens = tokenizeMarkup('[[#door.fancy Go|Hallway]]');
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
      const tokens = tokenizeMarkup('[[.fancy#door Go|Hallway]]');
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
      const tokens = tokenizeMarkup('{#first#second $name}');
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

  describe('svg tags', () => {
    it('tokenizes single-line <svg> as html tokens', () => {
      const tokens = tokenizeMarkup('<svg><circle r="5"/></svg>');
      expect(tokens).toEqual([
        {
          type: 'html',
          tag: 'svg',
          attributes: {},
          isClose: false,
          isSelfClose: false,
          start: 0,
          end: 5,
        },
        {
          type: 'html',
          tag: 'circle',
          attributes: { r: '5' },
          isClose: false,
          isSelfClose: true,
          start: 5,
          end: 20,
        },
        {
          type: 'html',
          tag: 'svg',
          attributes: {},
          isClose: true,
          isSelfClose: false,
          start: 20,
          end: 26,
        },
      ]);
    });

    it('tokenizes multi-line <svg> as html tokens', () => {
      const input =
        '<svg\n  class="icon">\n  <rect width="10" height="10"/>\n</svg>';
      const tokens = tokenizeMarkup(input);
      expect(tokens.map((t) => t.type)).toEqual([
        'html',
        'text',
        'html',
        'text',
        'html',
      ]);
      expect((tokens[0] as any).tag).toBe('svg');
      expect((tokens[0] as any).attributes).toEqual({ class: 'icon' });
      expect((tokens[2] as any).tag).toBe('rect');
      expect((tokens[4] as any).tag).toBe('svg');
      expect((tokens[4] as any).isClose).toBe(true);
    });

    it('tokenizes <svg> nested inside other html', () => {
      const tokens = tokenizeMarkup('<div><svg><circle r="5"/></svg></div>');
      expect(tokens.map((t) => t.type)).toEqual([
        'html',
        'html',
        'html',
        'html',
        'html',
      ]);
      const tags = tokens.map((t) => (t as any).tag);
      expect(tags).toEqual(['div', 'svg', 'circle', 'svg', 'div']);
    });
  });

  describe('expression tokens', () => {
    it('parses bracket access {$arr[$i]} as expression token', () => {
      const tokens = tokenizeMarkup('{$arr[$i]}');
      expect(tokens).toEqual([
        {
          type: 'expression',
          expression: '$arr[$i]',
          start: 0,
          end: 10,
        },
      ]);
    });

    it('parses nested bracket access {@p.labels[@p.level]}', () => {
      const tokens = tokenizeMarkup('{@p.labels[@p.level]}');
      expect(tokens).toEqual([
        {
          type: 'expression',
          expression: '@p.labels[@p.level]',
          start: 0,
          end: 21,
        },
      ]);
    });

    it('parses expression with nullish coalescing', () => {
      const tokens = tokenizeMarkup('{@p.labels[@p.level] ?? @p.level}');
      expect(tokens).toEqual([
        {
          type: 'expression',
          expression: '@p.labels[@p.level] ?? @p.level',
          start: 0,
          end: 33,
        },
      ]);
    });

    it('parses expression with ternary', () => {
      const tokens = tokenizeMarkup('{$x != null ? $x : 0}');
      expect(tokens).toEqual([
        {
          type: 'expression',
          expression: '$x != null ? $x : 0',
          start: 0,
          end: 21,
        },
      ]);
    });

    it('parses _temporary bracket access as expression', () => {
      const tokens = tokenizeMarkup('{_actions[$i].name}');
      expect(tokens).toEqual([
        {
          type: 'expression',
          expression: '_actions[$i].name',
          start: 0,
          end: 19,
        },
      ]);
    });

    it('keeps simple {$var} as variable token (regression)', () => {
      const tokens = tokenizeMarkup('{$health}');
      expect(tokens[0]).toMatchObject({ type: 'variable', name: 'health' });
    });

    it('keeps simple {$var.path} as variable token (regression)', () => {
      const tokens = tokenizeMarkup('{$player.name}');
      expect(tokens[0]).toMatchObject({
        type: 'variable',
        name: 'player.name',
      });
    });

    it('handles expression token in surrounding text', () => {
      const tokens = tokenizeMarkup('Level: {@p.labels[@p.level]} ok');
      expect(tokens).toHaveLength(3);
      expect(tokens[0]).toMatchObject({ type: 'text', value: 'Level: ' });
      expect(tokens[1]).toMatchObject({
        type: 'expression',
        expression: '@p.labels[@p.level]',
      });
      expect(tokens[2]).toMatchObject({ type: 'text', value: ' ok' });
    });

    it('parses {.class $expr[...]} with selector prefix as expression', () => {
      const tokens = tokenizeMarkup('{.highlight $arr[$i]}');
      expect(tokens).toEqual([
        {
          type: 'expression',
          expression: '$arr[$i]',
          className: 'highlight',
          start: 0,
          end: 21,
        },
      ]);
    });

    it('parses {#id @expr[...]} with id prefix as expression', () => {
      const tokens = tokenizeMarkup('{#val @map[@key]}');
      expect(tokens).toEqual([
        {
          type: 'expression',
          expression: '@map[@key]',
          id: 'val',
          start: 0,
          end: 17,
        },
      ]);
    });
  });

  describe('mixed content', () => {
    it('handles text, variables, links, and macros together', () => {
      const input = 'Hello {$name}! {set $seen = true}Go to [[Next]]';
      const tokens = tokenizeMarkup(input);
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
      const tokens = tokenizeMarkup('{if $x}yes{else}no{/if}');
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

describe('tokenizeMarkup — braces inside quoted strings (#169)', () => {
  it('keeps a } inside a double-quoted macro argument', () => {
    const tokens = tokenizeMarkup('{set $x = "}"}Value: {$x}');
    expect(tokens[0]).toMatchObject({
      type: 'macro',
      name: 'set',
      rawArgs: '$x = "}"',
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'Value: ' });
    expect(tokens[2]).toMatchObject({ type: 'variable', name: 'x' });
  });

  it('keeps a { inside a single-quoted macro argument', () => {
    const tokens = tokenizeMarkup("{set $x = '{'}after");
    expect(tokens[0]).toMatchObject({ type: 'macro', rawArgs: "$x = '{'" });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
  });

  it('handles escaped quotes inside strings', () => {
    const tokens = tokenizeMarkup('{set $x = "a\\"}"}after');
    expect(tokens[0]).toMatchObject({ type: 'macro', rawArgs: '$x = "a\\"}"' });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
  });

  it('keeps braces inside template literals, including ${} parts', () => {
    const tokens = tokenizeMarkup('{set $x = `}${"}" + `{`}{`}after');
    expect(tokens[0]).toMatchObject({
      type: 'macro',
      rawArgs: '$x = `}${"}" + `{`}{`',
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
  });

  it('keeps braces inside strings in selector-prefixed macros', () => {
    const tokens = tokenizeMarkup('{.c set $x = "}"}after');
    expect(tokens[0]).toMatchObject({
      type: 'macro',
      className: 'c',
      rawArgs: '$x = "}"',
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
  });

  it.each([
    ['{$x + "}"}', '$x + "}"'],
    ["{_x + '{'}", "_x + '{'"],
    ['{@x + `}`}', '@x + `}`'],
    ['{%x + "{"}', '%x + "{"'],
  ])('keeps braces inside strings in expression display %s', (src, expr) => {
    const tokens = tokenizeMarkup(src + 'after');
    expect(tokens[0]).toMatchObject({ type: 'expression', expression: expr });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
  });

  it('keeps braces inside strings in selector-prefixed expressions', () => {
    const tokens = tokenizeMarkup('{.c $x + "}"}after');
    expect(tokens[0]).toMatchObject({
      type: 'expression',
      expression: '$x + "}"',
      className: 'c',
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
  });

  it('keeps braces inside strings in HTML attribute interpolation', () => {
    const tokens = tokenizeMarkup(`<span title='{"{" + $x}'>t</span>`);
    expect(tokens[0]).toMatchObject({
      type: 'html',
      tag: 'span',
      attributes: { title: '{"{" + $x}' },
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 't' });
  });

  it('does not treat prose apostrophes as strings', () => {
    const tokens = tokenizeMarkup("{if $x}don't{/if} and 'quoted' {$y}");
    expect(tokens.map((t) => t.type)).toEqual([
      'macro',
      'text',
      'macro',
      'text',
      'variable',
    ]);
  });

  it('does not treat apostrophes inside unquoted macro args as strings', () => {
    const tokens = tokenizeMarkup("{goto Bob's room} and {goto Al's}");
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({ type: 'macro', rawArgs: "Bob's room" });
    expect(tokens[2]).toMatchObject({ type: 'macro', rawArgs: "Al's" });
  });

  it('treats a quote not closed on the same line as a plain character', () => {
    const tokens = tokenizeMarkup("{print ' + $x}\nmore '");
    expect(tokens[0]).toMatchObject({ type: 'macro', rawArgs: "' + $x" });
  });
});

describe('tokenizeMarkup — HTML void elements (#170)', () => {
  const VOID = [
    'area',
    'base',
    'br',
    'col',
    'embed',
    'hr',
    'img',
    'input',
    'link',
    'meta',
    'param',
    'source',
    'track',
    'wbr',
  ];

  it.each(VOID)('treats <%s> as self-closing', (tag) => {
    const tokens = tokenizeMarkup(`<${tag} class="x">after`);
    expect(tokens[0]).toMatchObject({
      type: 'html',
      tag,
      isClose: false,
      isSelfClose: true,
    });
  });

  it.each(VOID)('drops a redundant </%s> closing tag', (tag) => {
    const tokens = tokenizeMarkup(`<${tag}></${tag}>after`);
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toMatchObject({ type: 'html', isSelfClose: true });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
  });
});

describe('tokenizeMarkup — raw {do} bodies (#176)', () => {
  it('keeps a compact object literal as text', () => {
    const tokens = tokenizeMarkup(
      '{do}const obj={foo:1}; $x=obj.foo;{/do}after',
    );
    expect(tokens).toEqual([
      {
        type: 'macro',
        name: 'do',
        rawArgs: '',
        isClose: false,
        start: 0,
        end: 4,
      },
      {
        type: 'text',
        value: 'const obj={foo:1}; $x=obj.foo;',
        start: 4,
        end: 34,
      },
      {
        type: 'macro',
        name: 'do',
        rawArgs: '',
        isClose: true,
        start: 34,
        end: 39,
      },
      { type: 'text', value: 'after', start: 39, end: 44 },
    ]);
  });

  it('keeps HTML, macros, links and escapes in strings untouched', () => {
    const body = 'if(a<b){$s="<b>{x}</b> [[L]] {$y} \\{"}';
    const tokens = tokenizeMarkup(`{DO}${body}{/Do}`);
    expect(tokens).toHaveLength(3);
    expect(tokens[1]).toMatchObject({ type: 'text', value: body });
    expect(tokens[2]).toMatchObject({ type: 'macro', isClose: true });
  });

  it('handles selector-prefixed {do}', () => {
    const tokens = tokenizeMarkup('{.c do}x={a:1}{/do}');
    expect(tokens.map((t) => t.type)).toEqual(['macro', 'text', 'macro']);
    expect(tokens[1]).toMatchObject({ value: 'x={a:1}' });
  });

  it('produces no text token for an empty body', () => {
    const tokens = tokenizeMarkup('{do}{/do}');
    expect(tokens.map((t) => t.type)).toEqual(['macro', 'macro']);
  });

  it('leaves an unclosed {do} to the AST builder', () => {
    const tokens = tokenizeMarkup('{do}x = 1');
    expect(tokens.map((t) => t.type)).toEqual(['macro', 'text']);
  });
});

describe('tokenizeMarkup — duplicate attributes', () => {
  // Found by property testing: the last duplicate won, where HTML keeps
  // the first (names compare case-insensitively).
  it('keeps the first of duplicate attribute names', () => {
    const [token] = tokenizeMarkup('<span id="a" ID="b" title=x title=y>');
    expect(token).toMatchObject({ type: 'html' });
    expect((token as { attributes: object }).attributes).toEqual({
      id: 'a',
      title: 'x',
    });
  });

  it('keeps an attribute named __proto__ as an own property', () => {
    const [token] = tokenizeMarkup('<span __proto__="p">');
    const attributes = (token as { attributes: Record<string, string> })
      .attributes;
    expect(Object.keys(attributes)).toEqual(['__proto__']);
    expect(
      Object.getOwnPropertyDescriptor(attributes, '__proto__')!.value,
    ).toBe('p');
  });
});

describe('tokenizeMarkup — whitespace around attribute equals (#219)', () => {
  it.each([
    ['before and after', '<div id = "attrs">x</div>'],
    ['after only', '<div id= "attrs">x</div>'],
    ['before only', '<div id ="attrs">x</div>'],
    ['tabs and newlines', '<div id\t=\n"attrs">x</div>'],
  ])('parses a paired element with whitespace %s', (_label, markup) => {
    const tokens = tokenizeMarkup(markup);
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({
      type: 'html',
      tag: 'div',
      attributes: { id: 'attrs' },
      isClose: false,
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'x' });
    expect(tokens[2]).toMatchObject({
      type: 'html',
      tag: 'div',
      isClose: true,
    });
  });

  it.each([
    ['<input value= "a">'],
    ['<input value ="a">'],
    ['<input value = "a" />'],
    ["<input value = 'a'>"],
  ])('parses a void element: %s', (markup) => {
    const tokens = tokenizeMarkup(markup);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]).toMatchObject({
      type: 'html',
      tag: 'input',
      attributes: { value: 'a' },
      isSelfClose: true,
    });
  });

  it('parses unquoted values after spaced equals', () => {
    const tokens = tokenizeMarkup('<input type = text value = a>');
    expect(tokens[0]).toMatchObject({
      type: 'html',
      attributes: { type: 'text', value: 'a' },
    });
  });

  it('keeps interpolation in spaced attribute values', () => {
    const tokens = tokenizeMarkup('<div class = "c-{$x}" title = {$y}>t</div>');
    expect(tokens[0]).toMatchObject({
      type: 'html',
      tag: 'div',
      attributes: { class: 'c-{$x}', title: '{$y}' },
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 't' });
  });

  it('keeps following attributes after a spaced equals', () => {
    const tokens = tokenizeMarkup('<input id = "a" disabled value= "b">');
    expect(tokens[0]).toMatchObject({
      type: 'html',
      attributes: { id: 'a', disabled: '', value: 'b' },
    });
  });
});

describe('tokenizeMarkup — backslash runs before braces', () => {
  it('escapes a brace after a single backslash', () => {
    expect(tokenizeMarkup('\\{$x}')).toEqual([
      { type: 'text', value: '{', start: 0, end: 2 },
      { type: 'text', value: '$x}', start: 2, end: 5 },
    ]);
  });

  it('does not escape a brace after an even backslash run', () => {
    const tokens = tokenizeMarkup('C:\\\\{$dir}');
    expect(tokens).toHaveLength(2);
    expect(tokens[0]).toEqual({
      type: 'text',
      value: 'C:\\\\',
      start: 0,
      end: 4,
    });
    expect(tokens[1]).toMatchObject({ type: 'variable', name: 'dir' });
  });

  it('escapes with the last backslash of an odd run and keeps the rest', () => {
    expect(tokenizeMarkup('C:\\\\\\{$dir}')).toEqual([
      { type: 'text', value: 'C:\\\\', start: 0, end: 4 },
      { type: 'text', value: '{', start: 4, end: 6 },
      { type: 'text', value: '$dir}', start: 6, end: 11 },
    ]);
  });

  it('applies the same rule to closing braces', () => {
    expect(tokenizeMarkup('a\\\\\\}')).toEqual([
      { type: 'text', value: 'a\\\\', start: 0, end: 3 },
      { type: 'text', value: '}', start: 3, end: 5 },
    ]);
  });

  it('opens a macro after an even backslash run', () => {
    const tokens = tokenizeMarkup('\\\\{if true}y{/if}');
    expect(tokens[0]).toMatchObject({ type: 'text', value: '\\\\' });
    expect(tokens[1]).toMatchObject({ type: 'macro', name: 'if' });
  });
});

describe('tokenizeMarkup — template literals', () => {
  // A backtick in an interpolation that is never closed reads as closing
  // the template literal: the expression ends where its author meant it to,
  // and the story-start check reports the missing `}` in it
  // (test/unit/code-check.test.ts).
  it('ends an expression after a template literal whose interpolation is unclosed', () => {
    expect(tokenizeMarkup('Hi {$a + `${$b`} there')).toMatchObject([
      { type: 'text', value: 'Hi ' },
      { type: 'expression', expression: '$a + `${$b`' },
      { type: 'text', value: ' there' },
    ]);
  });

  it('reports an expression left open after a template literal', () => {
    expect(() => tokenizeMarkup('Hi {$a + `${$b}`')).toThrow(
      expect.objectContaining({
        reason: 'Unclosed {$…: no } ends it',
        line: 1,
        column: 4,
      }),
    );
  });

  it('still balances nested closed template literals', () => {
    const tokens = tokenizeMarkup('{print `a${`b${1}c`}d`}!');
    expect(tokens[0]).toMatchObject({
      type: 'macro',
      name: 'print',
      rawArgs: '`a${`b${1}c`}d`',
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: '!' });
  });
});

describe('tokenizeMarkup — JavaScript in macro arguments and expressions', () => {
  // Only a `}` in code, outside the brackets the code opened, ends a macro
  // or expression: braces, quotes and backticks inside string, template and
  // regex literals and comments don't count.
  it.each([
    ['{if /}/.test($s)}', 'if', '/}/.test($s)'],
    ['{set $x = 1 /* } */}', 'set', '$x = 1 /* } */'],
    ['{set $x = "a { b"}', 'set', '$x = "a { b"'],
    ['{button "a } b"}', 'button', '"a } b"'],
    ['{print $s.replace(/[{}]/g, "")}', 'print', '$s.replace(/[{}]/g, "")'],
    ['{set $r = /\\}/}', 'set', '$r = /\\}/'],
    ['{set $t = `${"}"}`}', 'set', '$t = `${"}"}`'],
    ['{set $x = 1 // }\n}', 'set', '$x = 1 // }'],
    ['{print /"/.test($s) + "}"}', 'print', '/"/.test($s) + "}"'],
    ["{print /'/.test($s) + '}'}", 'print', "/'/.test($s) + '}'"],
    ['{print /`/.test($s) + `}`}', 'print', '/`/.test($s) + `}`'],
    ['{print 1 /* " */ + "}"}', 'print', '1 /* " */ + "}"'],
    ['{print [/]}/][0]}', 'print', '[/]}/][0]'],
    ['{set $s = "line\n}"}', 'set', '$s = "line\n}"'],
    ['{.c print /}/.test($s)}', 'print', '/}/.test($s)'],
    ["{print typeof'}'}", 'print', "typeof'}'"],
  ])('macro %j', (src, name, rawArgs) => {
    const tokens = tokenizeMarkup(src + 'after');
    expect(tokens[0]).toMatchObject({ type: 'macro', name, rawArgs });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
    expect(tokens).toHaveLength(2);
  });

  it.each([
    ['{$s.replace(/}/g, "")}', '$s.replace(/}/g, "")'],
    ['{$a /* } */}', '$a /* } */'],
    ['{$a /2/ $b}', '$a /2/ $b'],
    ['{_a /2/ _b}', '_a /2/ _b'],
    ['{@a /2/ @b}', '@a /2/ @b'],
    ['{%a /2/ %b}', '%a /2/ %b'],
    ['{%a % /}/.source.length}', '%a % /}/.source.length'],
    ["{$s.split(/'/).join('}')}", "$s.split(/'/).join('}')"],
    ['{$a + `${/}/.source}`}', '$a + `${/}/.source}`'],
    ['{$a // }\n}', '$a // }\n'],
  ])('expression %j', (src, expression) => {
    const tokens = tokenizeMarkup(src + 'after');
    expect(tokens[0]).toMatchObject({ type: 'expression', expression });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
    expect(tokens).toHaveLength(2);
  });

  it('lexes selector-prefixed expressions', () => {
    const tokens = tokenizeMarkup('{.c $s.replace(/}/g, "")}after');
    expect(tokens[0]).toMatchObject({
      type: 'expression',
      expression: '$s.replace(/}/g, "")',
      className: 'c',
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after' });
  });

  // Code attributes keep backslashes as text (docs/markup.md), so a
  // backslash before `{$…}` doesn't stop the reference hiding its quotes.
  it('reads a backslash before a reference in a code attribute as text', () => {
    const value = String.raw`f('\{$a.replace(/"/g, "'")}')`;
    const tokens = tokenizeMarkup(
      `<b onclick="${value}" title="\\{$a" id="i">x</b>`,
    );
    expect(tokens[0]).toMatchObject({
      type: 'html',
      attributes: { onclick: value, title: '\\{$a', id: 'i' },
    });
  });

  it('reads only sigil references as blocks in a code attribute', () => {
    const value = `{a{$a.replace(/[}"']/g, '{')}`;
    const tokens = tokenizeMarkup(`<b onclick="${value}" id="i">x</b>`);
    expect(tokens[0]).toMatchObject({
      type: 'html',
      attributes: { onclick: value, id: 'i' },
    });
  });

  it('lexes macros in attribute values after their names', () => {
    const tokens = tokenizeMarkup(
      `<i title="{if /"}/.test($s)}a{/if}" class="{.c print '"'}">t</i>`,
    );
    expect(tokens[0]).toMatchObject({
      type: 'html',
      attributes: {
        title: `{if /"}/.test($s)}a{/if}`,
        class: `{.c print '"'}`,
      },
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 't' });
  });

  it('lexes HTML attribute interpolations', () => {
    const tokens = tokenizeMarkup(
      `<span title='{$s.replace(/'/g, "}")}' id=x>t</span>`,
    );
    expect(tokens[0]).toMatchObject({
      type: 'html',
      attributes: { title: `{$s.replace(/'/g, "}")}`, id: 'x' },
    });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 't' });
  });

  it('reads `/` after an operand as division', () => {
    const tokens = tokenizeMarkup('{print ($a) / 2 + "}"}after {$b /1}');
    expect(tokens[0]).toMatchObject({ rawArgs: '($a) / 2 + "}"' });
    expect(tokens[1]).toMatchObject({ type: 'text', value: 'after ' });
    expect(tokens[2]).toMatchObject({ expression: '$b /1' });
  });

  // Text that is not well-formed JavaScript keeps the tokenizer's lenient
  // reading: apostrophes are text and a quote not closed on its line is a
  // plain character.
  it.each([
    ["{goto Bob's room}", "Bob's room"],
    ["{print ' + $x}", "' + $x"],
    ['{print "a + $x}', '"a + $x'],
    ['{print /a + $x}', '/a + $x'],
    ['{print `a + $x}', '`a + $x'],
    ['{print 1 /* a}', '1 /* a'],
    ['{print (1}', '(1'],
  ])('falls back on malformed code %j', (src, rawArgs) => {
    const tokens = tokenizeMarkup(src + '\nafter');
    expect(tokens[0]).toMatchObject({ type: 'macro', rawArgs });
    expect(tokens[1]).toMatchObject({ type: 'text', value: '\nafter' });
  });
});

describe('tokenizeMarkup — {do} bodies are lexed as JavaScript', () => {
  it.each([
    '$x = "{/do}";',
    "$x = '{/do}';",
    '$x = `{/do}`;',
    '$x = `${"{/do}"}`;',
    '$x = /[{/do}]/;',
    '$x = 1; /* {/do} */',
    '$x = 1; // {/do}\n',
    'if (a) { $x = "}" }',
  ])('a {/do} in a literal or comment does not end the body: %j', (body) => {
    const tokens = tokenizeMarkup(`{do}${body}{/do}after`);
    expect(tokens.map((t) => t.type)).toEqual([
      'macro',
      'text',
      'macro',
      'text',
    ]);
    expect(tokens[1]).toMatchObject({ value: body });
    expect(tokens[2]).toMatchObject({ name: 'do', isClose: true });
    expect(tokens[3]).toMatchObject({ value: 'after' });
  });

  it('ends the body at a {/do} in code, at any depth', () => {
    const tokens = tokenizeMarkup('{do}if (a) { b(){/do}after');
    expect(tokens[1]).toMatchObject({ value: 'if (a) { b()' });
    expect(tokens[3]).toMatchObject({ value: 'after' });
  });

  it('falls back to the first {/do} when the body is malformed', () => {
    const tokens = tokenizeMarkup('{do}$x = "a{/do}after');
    expect(tokens[1]).toMatchObject({ value: '$x = "a' });
    expect(tokens[2]).toMatchObject({ name: 'do', isClose: true });
    expect(tokens[3]).toMatchObject({ value: 'after' });
  });

  it('falls back to the first {/do} when no {/do} is in code', () => {
    const tokens = tokenizeMarkup('{do}$x = 1 // c{/do}after');
    expect(tokens[1]).toMatchObject({ value: '$x = 1 // c' });
    expect(tokens[3]).toMatchObject({ value: 'after' });
  });
});

describe('tokenizeMarkup — expressions opened by ( or ! (#225)', () => {
  it('reads {!expr} as an expression', () => {
    expect(tokenizeMarkup("{!$n ? 'zero' : 'nonzero'}")).toEqual([
      {
        type: 'expression',
        expression: "!$n ? 'zero' : 'nonzero'",
        start: 0,
        end: 26,
      },
    ]);
  });

  it('reads {(expr)} as an expression, braces in strings included', () => {
    const tokens = tokenizeMarkup('a {(Math.max($a, 0) + "}")} b');
    expect(tokens).toEqual([
      { type: 'text', value: 'a ', start: 0, end: 2 },
      {
        type: 'expression',
        expression: '(Math.max($a, 0) + "}")',
        start: 2,
        end: 27,
      },
      { type: 'text', value: ' b', start: 27, end: 29 },
    ]);
  });

  it('takes selectors before the expression', () => {
    expect(tokenizeMarkup('{.big#n !$x}')).toEqual([
      {
        type: 'expression',
        expression: '!$x',
        className: 'big',
        id: 'n',
        start: 0,
        end: 12,
      },
    ]);
  });

  it('reports an unclosed one', () => {
    for (const src of ['{(a', 'x {!$a']) {
      const at = src.indexOf('{');
      expect(() => tokenizeMarkup(src), src).toThrow(
        expect.objectContaining({
          reason: `Unclosed {${src[at + 1]}…: no } ends it`,
          line: 1,
          column: at + 1,
        }),
      );
    }
  });

  it('keeps an escaped one as text', () => {
    const tokens = tokenizeMarkup('\\{!$x}');
    expect(tokens.every((t) => t.type === 'text')).toBe(true);
  });

  it('keeps other non-sigil braces as text', () => {
    for (const src of ['{"a": 1}', "{'a'}", '{[1]}', '{-1}', '{ $x }']) {
      expect(tokenizeMarkup(src), src).toEqual([
        { type: 'text', value: src, start: 0, end: src.length },
      ]);
    }
  });
});

describe('tokenizeMarkup — text mode (attribute values, #225)', () => {
  const text = (src: string) => tokenizeMarkup(src, { text: true });
  const joined = (src: string) =>
    text(src)
      .map((t) => (t.type === 'text' ? t.value : `<${t.type}>`))
      .join('');

  it('reads variables, expressions and macros as in passage text', () => {
    expect(text('a {$x} {!$y} {if $z}b{/if}').map((t) => t.type)).toEqual([
      'text',
      'variable',
      'text',
      'expression',
      'text',
      'macro',
      'text',
      'macro',
    ]);
  });

  it('keeps links and HTML tags as text', () => {
    expect(joined('[[Start]] <b>x</b>')).toBe('[[Start]] <b>x</b>');
  });

  it('pairs up the backslashes before a brace, as rendered passage text does', () => {
    expect(joined('\\{$x}')).toBe('{$x}');
    expect(joined('C:\\\\{$x}')).toBe('C:\\<variable>');
    expect(joined('C:\\\\\\{$x}')).toBe('C:\\{$x}');
    expect(joined('\\}')).toBe('}');
    // Backslashes not before a brace are kept as written.
    expect(joined('a\\b\\\\c\\')).toBe('a\\b\\\\c\\');
  });
});

describe('tokenizeMarkup — escaped braces in attribute values (#225)', () => {
  it('does not start an interpolation at an escaped brace', () => {
    const tokens = tokenizeMarkup('<i title="\\{" class="{$x}">a</i>}');
    expect(tokens[0]).toMatchObject({
      type: 'html',
      tag: 'i',
      attributes: { title: '\\{', class: '{$x}' },
    });
  });
});
