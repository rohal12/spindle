// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import {
  registerWidget,
  clearWidgets,
  isBlockWidget,
} from '../../src/widgets/widget-registry';
import { tokenize } from '../../src/markup/tokenizer';
import {
  buildAST,
  registerBlockMacro,
  unregisterBlockMacro,
} from '../../src/markup/ast';
import { astContainsChildren } from '../../src/widgets/ast-scanner';
import type { ASTNode } from '../../src/markup/ast';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[], startNode = 1): StoryData {
  const byName = new Map(passages.map((p) => [p.name, p]));
  const byId = new Map(passages.map((p) => [p.pid, p]));
  return {
    name: 'Test',
    startNode,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: byName,
    passagesById: byId,
    userCSS: '',
    userScript: '',
  };
}

/** Register a widget from definition markup, mimicking boot-time logic. */
function defineWidget(markup: string): void {
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  for (const node of ast) {
    if (node.type === 'macro' && node.name === 'widget' && node.rawArgs) {
      const parts = node.rawArgs.trim().split(/\s+/);
      const name = parts[0]!.replace(/["']/g, '');
      const params = parts
        .slice(1)
        .filter(
          (t) => t.startsWith('$') || t.startsWith('_') || t.startsWith('@'),
        );
      const children = node.children as ASTNode[];
      const isBlock = astContainsChildren(children);
      registerWidget(name, children, params, isBlock);
      if (isBlock) registerBlockMacro(name);
    }
  }
}

function renderPassage(content: string): HTMLElement {
  const passage = makePassage(1, 'Test', content);
  const storyData = makeStoryData([passage]);
  useStoryStore.getState().init(storyData);
  const container = document.createElement('div');
  render(<Passage passage={passage} />, container);
  return container;
}

// Track registered block macros for cleanup
const registeredBlockMacros: string[] = [];

describe('block widgets', () => {
  beforeEach(() => {
    clearWidgets();
    for (const name of registeredBlockMacros) {
      unregisterBlockMacro(name);
    }
    registeredBlockMacros.length = 0;
  });

  function defineAndTrack(markup: string) {
    // Extract widget name for cleanup
    const match = markup.match(/\{widget\s+"(\w+)"/);
    if (match) registeredBlockMacros.push(match[1]!);
    defineWidget(markup);
  }

  it('renders invocation children at @children slot', () => {
    defineAndTrack(
      '{widget "Wrapper"}<div class="wrap">{@children}</div>{/widget}',
    );
    const el = renderPassage('{Wrapper}inner content{/Wrapper}');
    const wrap = el.querySelector('.wrap');
    expect(wrap).not.toBeNull();
    expect(wrap!.textContent).toContain('inner content');
  });

  it('renders widget params alongside @children', () => {
    defineAndTrack(
      '{widget "Card" @title}<div class="card"><h2>{@title}</h2>{@children}</div>{/widget}',
    );
    const el = renderPassage('{Card "My Title"}card body{/Card}');
    const card = el.querySelector('.card');
    expect(card).not.toBeNull();
    const h2 = card!.querySelector('h2');
    expect(h2!.textContent).toContain('My Title');
    expect(card!.textContent).toContain('card body');
  });

  it('mirrors @children when referenced multiple times', () => {
    defineAndTrack(
      '{widget "Mirror"}<div class="a">{@children}</div><div class="b">{@children}</div>{/widget}',
    );
    const el = renderPassage('{Mirror}hello{/Mirror}');
    const a = el.querySelector('.a');
    const b = el.querySelector('.b');
    expect(a!.textContent).toContain('hello');
    expect(b!.textContent).toContain('hello');
  });

  it('renders nothing for @children when invocation body is empty', () => {
    defineAndTrack(
      '{widget "Empty"}<div class="box">{@children}</div>{/widget}',
    );
    const el = renderPassage('{Empty}{/Empty}');
    const box = el.querySelector('.box');
    expect(box).not.toBeNull();
    expect(box!.textContent!.trim()).toBe('');
  });

  it('self-closing widgets remain unaffected', () => {
    const body: ASTNode[] = [{ type: 'text', value: 'simple' }];
    registerWidget('Simple', body, ['@name']);
    // Self-closing widget — not a block macro, no @children in body
    const el = renderPassage('{Simple "test"}');
    expect(el.textContent).toContain('simple');
  });

  it('widget params shadow outer locals of the same name', () => {
    defineAndTrack(
      '{widget "Shadow" @val}<span class="inner">{@val}</span>{@children}{/widget}',
    );
    const el = renderPassage('{Shadow "widget-val"}body{/Shadow}');
    const inner = el.querySelector('.inner');
    expect(inner!.textContent).toContain('widget-val');
  });

  it('non-block widget inside block widget does not inherit children context', () => {
    // Define a non-block widget (no @children in body)
    const innerBody: ASTNode[] = [{ type: 'text', value: 'inner-only' }];
    registerWidget('Inner', innerBody, []);

    // Define a block widget
    defineAndTrack(
      '{widget "Outer"}<div class="outer">{@children}</div>{/widget}',
    );

    // Invoke block widget with non-block widget inside
    const el = renderPassage('{Outer}{Inner}{/Outer}');
    const outer = el.querySelector('.outer');
    expect(outer!.textContent).toContain('inner-only');
  });

  it('nested block widgets work correctly', () => {
    defineAndTrack('{widget "Box"}<div class="box">{@children}</div>{/widget}');
    defineAndTrack(
      '{widget "Frame"}<div class="frame">{@children}</div>{/widget}',
    );
    const el = renderPassage('{Box}{Frame}deep content{/Frame}{/Box}');
    const box = el.querySelector('.box');
    const frame = box!.querySelector('.frame');
    expect(frame).not.toBeNull();
    expect(frame!.textContent).toContain('deep content');
  });

  it('detects block widget correctly via isBlockWidget', () => {
    defineAndTrack('{widget "Block"}<div>{@children}</div>{/widget}');
    expect(isBlockWidget('block')).toBe(true);
    expect(isBlockWidget('Block')).toBe(true);
  });

  it('non-block widget is not detected as block', () => {
    defineWidget('{widget "Plain" @name}Hello {@name}{/widget}');
    expect(isBlockWidget('plain')).toBe(false);
  });

  it('block widget used inside another widget definition parses regardless of order', () => {
    // Simulate the two-pass approach from index.tsx:
    // Pass 1: pre-scan raw text to discover block widgets
    const passageA =
      '{widget "Section" @title}<section><h3>{@title}</h3>{@children}</section>{/widget}';
    const passageB =
      '{widget "Card" @name}{Section "Details"}{@name}{/Section}{/widget}';

    // If we parse passage B first WITHOUT pre-scanning, Section isn't
    // in BLOCK_MACROS and buildAST would fail on {/Section}.
    // Pre-scan passageA to register Section as block macro first.
    const pattern = /\{widget\s+["']?(\w+)["']?[^}]*\}([\s\S]*?)\{\/widget\}/g;
    let m;
    while ((m = pattern.exec(passageA)) !== null) {
      if (/\{@children\}/.test(m[2]!)) {
        registerBlockMacro(m[1]!);
        registeredBlockMacros.push(m[1]!);
      }
    }

    // Now parse B first (the problematic order), then A
    defineWidget(passageB);
    defineWidget(passageA);

    const el = renderPassage('{Card "Alice"}');
    expect(el.textContent).toContain('Details');
    expect(el.textContent).toContain('Alice');
  });

  it('renders @children inside {if} within widget body', () => {
    defineAndTrack(
      '{widget "Conditional" @show}{if @show}<div class="wrap">{@children}</div>{/if}{/widget}',
    );
    const el = renderPassage('{Conditional true}content here{/Conditional}');
    const wrap = el.querySelector('.wrap');
    expect(wrap).not.toBeNull();
    expect(wrap!.textContent).toContain('content here');
  });
});
