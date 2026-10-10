import { describe, it, expect } from 'vitest';
import { tokenizeMarkup, tokenizeMarkupTolerant } from '../../src/markup/parse';
import { pairMarkup, type PairedNode } from '../../src/markup/pair';
import type { MacroToken } from '../../src/markup/tokens';

const pair = (src: string, isBlock?: (name: string) => boolean) =>
  pairMarkup(tokenizeMarkupTolerant(src).tokens, { isBlock, source: src });

/** The name or tag of the opening token of a node. */
const nameOf = (node: PairedNode) =>
  node.token.type === 'macro'
    ? node.token.name
    : node.token.type === 'html'
      ? node.token.tag
      : node.token.type;

describe('pairMarkup (#448)', () => {
  it('nests blocks and keeps the spans of the tags', () => {
    const src = 'a {if $a}x{for $i of $l}y{/for}{else}z{/if} b';
    const { nodes, errors } = pair(src);
    expect(errors).toEqual([]);
    expect(nodes.map(nameOf)).toEqual(['text', 'if', 'text']);
    const block = nodes[1]!;
    expect(src.slice(block.start, block.end)).toBe(
      '{if $a}x{for $i of $l}y{/for}{else}z{/if}',
    );
    const body = block.body!;
    expect(body.children.map(nameOf)).toEqual(['text', 'for']);
    const close = body.close as MacroToken;
    expect(src.slice(close.start, close.end)).toBe('{/if}');
    expect(body.branches).toHaveLength(1);
    const branch = body.branches[0]!;
    expect(src.slice(branch.tag.start, branch.tag.end)).toBe('{else}');
    expect(branch.children.map(nameOf)).toEqual(['text']);
    const inner = body.children[1]!;
    expect(src.slice(inner.start, inner.end)).toBe('{for $i of $l}y{/for}');
  });

  it('pairs HTML elements, and leaves void and self-closing ones alone', () => {
    const src = '<div><br><p>t</p><i/></div>';
    const { nodes, errors } = pair(src);
    expect(errors).toEqual([]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.body!.children.map(nameOf)).toEqual(['br', 'p', 'i']);
    expect(nodes[0]!.body!.children[0]!.body).toBeUndefined();
    expect(nodes[0]!.body!.children[2]!.body).toBeUndefined();
  });

  it('gives {case}/{default} and {next} to their macros', () => {
    const { nodes, errors } = pair(
      '{switch $a}{case 1}x{default}y{/switch}{timed 1s}a{next 2s}b{/timed}',
    );
    expect(errors).toEqual([]);
    expect(nodes[0]!.body!.branches.map((b) => b.tag.name)).toEqual([
      'case',
      'default',
    ]);
    expect(nodes[1]!.body!.branches.map((b) => b.tag.name)).toEqual(['next']);
  });

  it('takes the blocks the caller names, widgets included', () => {
    const src = '{card "x"}inside{/card}';
    const open = pair(src, (name) => name === 'card');
    expect(open.errors).toEqual([]);
    expect(open.nodes.map(nameOf)).toEqual(['card']);
    expect(open.nodes[0]!.body!.children.map(nameOf)).toEqual(['text']);
    // Not a block: its closer closes nothing
    const flat = pair(src, () => false);
    expect(flat.nodes.map(nameOf)).toEqual(['card', 'text']);
    expect(flat.errors.map((e) => e.code)).toEqual(['stray-closer']);
  });

  it('reports a closer that closes nothing, and goes on', () => {
    const src = 'a {/if} b {if $x}c{/if}';
    const { nodes, errors } = pair(src);
    expect(errors).toHaveLength(1);
    const [error] = errors;
    expect(error).toMatchObject({
      code: 'stray-closer',
      message: '{/if} closes nothing: no {if} is open here',
    });
    expect(src.slice(error!.start, error!.end)).toBe('{/if}');
    expect(nodes.map(nameOf)).toEqual(['text', 'text', 'if']);
  });

  it('reports what is left open, innermost first, and keeps the tree', () => {
    const src = '{if $a}\n  <div>{for $i of $l}t';
    const { nodes, errors } = pair(src);
    expect(errors.map((e) => [e.code, src.slice(e.start, e.end)])).toEqual([
      ['unclosed-block', '{for $i of $l}'],
      ['unclosed-block', '<div>'],
      ['unclosed-block', '{if $a}'],
    ]);
    expect(errors[0]!.message).toBe('Unclosed {for}: no {/for} closes it');
    expect(errors.every((e) => e.noticedAt === src.length + 1)).toBe(true);
    const div = nodes[0]!.body!.children[1]!;
    expect(div.body!.close).toBeUndefined();
    expect(div.body!.children[0]!.body!.children.map(nameOf)).toEqual(['text']);
  });

  it('closes the innermost element with a closer that names none open', () => {
    const src = '<div>t{/if}<p>';
    const { errors, nodes } = pair(src);
    expect(errors.map((e) => [e.code, src.slice(e.start, e.end)])).toEqual([
      ['mismatched-closer', '{/if}'],
      ['unclosed-block', '<p>'],
    ]);
    expect(errors[0]!.message).toBe(
      '{/if} found where </div> should close the <div> opened at line 1, column 1',
    );
    expect(errors[0]!.noticedAt).toBe(11);
    // As the runtime reads it: the closer ends the <div>
    expect(nodes.map(nameOf)).toEqual(['div', 'p']);
    expect((nodes[0]!.body!.close as MacroToken).name).toBe('if');
  });

  it('closes an element further out that the closer names, leaving the inner one open', () => {
    const src = 'x\n{if $a}<div>t{/if}';
    const { errors, nodes } = pair(src);
    expect(errors.map((e) => [e.code, src.slice(e.start, e.end)])).toEqual([
      ['mismatched-closer', '{/if}'],
    ]);
    expect(errors[0]!.message).toBe(
      '{/if} found where </div> should close the <div> opened at line 2, column 8',
    );
    const block = nodes[1]!;
    expect((block.body!.close as MacroToken).name).toBe('if');
    expect(block.body!.children[0]!.body!.close).toBeUndefined();
  });

  it('closes an outer element when the closer names it, leaving the inner open', () => {
    const src = '{a}{b}t{/a}u{/b}';
    const { nodes, errors } = pair(src, () => true);
    expect(errors.map((e) => [e.code, src.slice(e.start, e.end)])).toEqual([
      ['mismatched-closer', '{/a}'],
      ['stray-closer', '{/b}'],
    ]);
    const a = nodes[0]!;
    expect(src.slice(a.start, a.end)).toBe('{a}{b}t{/a}');
    expect((a.body!.close as MacroToken).name).toBe('a');
    expect(a.body!.children[0]!.body!.close).toBeUndefined();
    expect(nodes.map(nameOf)).toEqual(['a', 'text']);
  });

  it('reports a branch outside its macro', () => {
    const src = '{else}<div>{case 1}x</div>{if $a}{elseif $b}{/if}';
    const { errors } = pair(src);
    expect(
      errors.map((e) => [e.code, src.slice(e.start, e.end), e.message]),
    ).toEqual([
      ['misplaced-branch', '{else}', '{else} must be directly inside {if}'],
      [
        'misplaced-branch',
        '{case 1}',
        '{case} must be directly inside {switch}, not inside <div>',
      ],
    ]);
  });

  it('says offsets when it is not given the source', () => {
    const tokens = tokenizeMarkup('{if}<div>{/if}');
    const { errors } = pairMarkup(tokens);
    expect(errors[0]!.message).toBe(
      '{/if} found where </div> should close the <div> opened at offset 4',
    );
  });

  it('reads half-typed markup around the tags it cannot read', () => {
    const src = '{if $a}[[unfinished {for $i of $l}x{/for}{';
    const { tokens, errors: tokenErrors } = tokenizeMarkupTolerant(src);
    expect(tokenErrors.length).toBeGreaterThan(0);
    const { nodes, errors } = pairMarkup(tokens, { source: src });
    expect(nodes.map(nameOf)).toEqual(['if']);
    expect(nodes[0]!.body!.children.map(nameOf)).toContain('for');
    expect(errors.map((e) => e.code)).toEqual(['unclosed-block']);
  });

  it('counts offsets in UTF-16 over CRLF and multibyte text', () => {
    const src = '\u{1F600}\r\n{if $a}é{/if}';
    const { nodes } = pair(src);
    const block = nodes[1]!;
    expect(src.slice(block.start, block.end)).toBe('{if $a}é{/if}');
  });
});
