import { describe, it, expect } from 'vitest';
import { tokenizeMarkup, tokenizeMarkupTolerant } from '../../src/markup/parse';
import type { HtmlToken, Token } from '../../src/markup/tokens';

/** The text of `[start, end)` in `src`. */
const slice = (src: string, start?: number, end?: number) =>
  src.slice(start, end);

const only = <T extends Token['type']>(
  src: string,
  type: T,
  options?: { text?: boolean },
) =>
  tokenizeMarkup(src, options).find((t) => t.type === type) as Extract<
    Token,
    { type: T }
  >;

describe('macro token spans (#450)', () => {
  it('span the name, the arguments and the selectors', () => {
    const src = '{.a-{$x}#id button "Go"}';
    const t = only(src, 'macro');
    expect(slice(src, t.nameStart, t.nameEnd)).toBe('button');
    expect(slice(src, t.argsStart, t.argsEnd)).toBe('"Go"');
    expect(slice(src, t.selectorsStart, t.selectorsEnd)).toBe('.a-{$x}#id');
  });

  it('span the arguments without the whitespace around them', () => {
    const src = '{set   $x = 1  }';
    const t = only(src, 'macro');
    expect(t.rawArgs).toBe('$x = 1');
    expect(slice(src, t.argsStart, t.argsEnd)).toBe('$x = 1');
  });

  it('give no selectors span without selectors, an empty one for no args', () => {
    const src = '{else }';
    const t = only(src, 'macro');
    expect(t.selectorsStart).toBeUndefined();
    expect(t.selectorsEnd).toBeUndefined();
    expect(t.argsStart).toBe(t.argsEnd);
    expect(slice(src, t.nameStart, t.nameEnd)).toBe('else');
  });

  it('span the name of a closer', () => {
    const src = 'a {/button} b';
    const t = only(src, 'macro');
    expect(t.isClose).toBe(true);
    expect(slice(src, t.nameStart, t.nameEnd)).toBe('button');
  });

  it('count UTF-16 offsets after CRLF and multibyte text', () => {
    const src = 'héllo \u{1F600}\r\n{.k link "\u{1F600}" "Home"}';
    const t = only(src, 'macro');
    expect(slice(src, t.nameStart, t.nameEnd)).toBe('link');
    expect(slice(src, t.argsStart, t.argsEnd)).toBe('"\u{1F600}" "Home"');
    expect(slice(src, t.selectorsStart, t.selectorsEnd)).toBe('.k');
  });

  it('are found after an escaped brace', () => {
    const src = '\\{ not markup {if $a}';
    const t = only(src, 'macro');
    expect(slice(src, t.nameStart, t.nameEnd)).toBe('if');
    expect(slice(src, t.argsStart, t.argsEnd)).toBe('$a');
  });
});

describe('link token spans (#450)', () => {
  it.each([
    ['[[Go|Home]]', 'Go', 'Home'],
    ['[[Go->Home]]', 'Go', 'Home'],
    ['[[Home<-Go]]', 'Go', 'Home'],
    ['[[ Go  ->  Home ]]', 'Go', 'Home'],
    ['[[Home]]', 'Home', 'Home'],
  ])('span the label and the target of %s', (src, label, target) => {
    const t = only(src, 'link');
    expect(slice(src, t.displayStart, t.displayEnd)).toBe(label);
    expect(slice(src, t.targetStart, t.targetEnd)).toBe(target);
  });

  it('span the selectors, and the label with markup', () => {
    const src = '[[.c#i {if $a || $b}x{/if}->Home]]';
    const t = only(src, 'link');
    expect(slice(src, t.selectorsStart, t.selectorsEnd)).toBe('.c#i');
    expect(slice(src, t.displayStart, t.displayEnd)).toBe(
      '{if $a || $b}x{/if}',
    );
  });
});

describe('variable and expression token spans (#450)', () => {
  it('span the name without the sigil and the selectors', () => {
    const src = 'x {$player.hp} y {.hot $player.hp}';
    const [a, b] = tokenizeMarkup(src).filter((t) => t.type === 'variable') as [
      Extract<Token, { type: 'variable' }>,
      Extract<Token, { type: 'variable' }>,
    ];
    expect(slice(src, a.nameStart, a.nameEnd)).toBe('player.hp');
    expect(slice(src, b.nameStart, b.nameEnd)).toBe('player.hp');
    expect(slice(src, b.selectorsStart, b.selectorsEnd)).toBe('.hot');
  });

  it('span the expression', () => {
    const src = '{.big (1 + $x) * 2}';
    const t = only(src, 'expression');
    expect(slice(src, t.expressionStart, t.expressionEnd)).toBe(t.expression);
    expect(t.expression).toBe('(1 + $x) * 2');
    expect(slice(src, t.selectorsStart, t.selectorsEnd)).toBe('.big');
  });
});

describe('html token spans (#450)', () => {
  const src =
    '<a  href="x" title=\'y\' data-z=w disabled HREF="dup" data={n}>t</a>';

  it('span the tag name, of the opener and the closer', () => {
    const [open, close] = tokenizeMarkup(src).filter(
      (t) => t.type === 'html',
    ) as HtmlToken[];
    expect(slice(src, open!.tagNameStart, open!.tagNameEnd)).toBe('a');
    expect(slice(src, close!.tagNameStart, close!.tagNameEnd)).toBe('a');
    expect(close!.attributeSpans).toEqual([]);
  });

  it('span each attribute as written, duplicates and all', () => {
    const open = only(src, 'html');
    const spans = open.attributeSpans.map((a) => ({
      name: slice(src, a.nameStart, a.nameEnd),
      value:
        a.valueStart === undefined
          ? null
          : slice(src, a.valueStart, a.valueEnd),
      quote: a.quote,
    }));
    expect(spans).toEqual([
      { name: 'href', value: 'x', quote: '"' },
      { name: 'title', value: 'y', quote: "'" },
      { name: 'data-z', value: 'w', quote: undefined },
      { name: 'disabled', value: null, quote: undefined },
      { name: 'HREF', value: 'dup', quote: '"' },
      { name: 'data', value: '{n}', quote: undefined },
    ]);
    // The record keeps the first of equal names, as before
    expect(open.attributes.href).toBe('x');
    expect(Object.keys(open.attributes)).not.toContain('HREF');
  });

  it('keep markup, braces and CRLF in a value inside its quotes', () => {
    const text = 'x\r\n<b title="{$a}\r\n\u{1F600} {if $c}1{/if}" id=\'q\'>';
    const t = only(text, 'html');
    const title = t.attributeSpans[0]!;
    expect(slice(text, title.valueStart, title.valueEnd)).toBe(
      '{$a}\r\n\u{1F600} {if $c}1{/if}',
    );
    expect(t.attributes.title).toBe(
      slice(text, title.valueStart, title.valueEnd),
    );
  });

  it('are the same in text mode, where there are no tags', () => {
    expect(tokenizeMarkup('<a href="x">', { text: true })).toHaveLength(1);
  });
});

describe('tolerant tokens carry the same spans (#450)', () => {
  const good =
    '{.a button "Go"}\r\n[[.c L|T]] {.q $v} <a b="1" c>x</a> {/button}';

  it('as the strict tokens for well-formed markup', () => {
    const { tokens, errors } = tokenizeMarkupTolerant(good);
    expect(errors).toEqual([]);
    expect(tokens).toEqual(tokenizeMarkup(good));
  });

  it('with offsets in the source after a malformed tag', () => {
    const src = `[[oops \u{1F600}\r\n${good}`;
    const { tokens, errors } = tokenizeMarkupTolerant(src);
    expect(errors).toHaveLength(1);
    const html = tokens.find((t) => t.type === 'html' && !t.isClose) as
      | HtmlToken
      | undefined;
    expect(slice(src, html!.tagNameStart, html!.tagNameEnd)).toBe('a');
    const [b, c] = html!.attributeSpans;
    expect(slice(src, b!.valueStart, b!.valueEnd)).toBe('1');
    expect(slice(src, c!.nameStart, c!.nameEnd)).toBe('c');
    const variable = tokens.find((t) => t.type === 'variable') as Extract<
      Token,
      { type: 'variable' }
    >;
    expect(slice(src, variable.nameStart, variable.nameEnd)).toBe('v');
    expect(slice(src, variable.selectorsStart, variable.selectorsEnd)).toBe(
      '.q',
    );
    const link = tokens.find((t) => t.type === 'link') as Extract<
      Token,
      { type: 'link' }
    >;
    expect(slice(src, link.displayStart, link.displayEnd)).toBe('L');
    const macro = tokens.find((t) => t.type === 'macro') as Extract<
      Token,
      { type: 'macro' }
    >;
    expect(slice(src, macro.argsStart, macro.argsEnd)).toBe('"Go"');
  });
});
