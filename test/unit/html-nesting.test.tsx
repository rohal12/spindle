// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST, type ASTNode, type HtmlNode } from '../../src/markup/ast';
import { renderNodes, NobrContext } from '../../src/markup/render';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function parse(input: string): ASTNode[] {
  return buildAST(tokenize(input));
}

function makePassage(
  pid: number,
  name: string,
  content: string,
  tags: string[] = [],
): PassageData {
  return { pid, name, tags, metadata: {}, content };
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

// Exact passage content from issue #61
const shellContent =
  '<div class="shell"><div class="header">Header</div>{include "DialogSidebar"}<div class="content"><div class="inner">Content here</div></div></div>';
const sidebarContent =
  '<div class="sidebar"><div class="nav"><div class="item">Home</div><div class="item">Settings</div><div class="item">About</div></div><div class="footer">v1.0</div></div>';

describe('issue #61: deeply nested HTML with {include}', () => {
  describe('tokenize + buildAST (unit level)', () => {
    it('parses DialogShell passage', () => {
      const ast = parse(shellContent);
      expect(ast).toHaveLength(1);
      expect((ast[0] as HtmlNode).tag).toBe('div');
    });

    it('parses DialogSidebar passage', () => {
      const ast = parse(sidebarContent);
      expect(ast).toHaveLength(1);
      expect((ast[0] as HtmlNode).tag).toBe('div');
    });

    it('handles 15 levels of nested divs', () => {
      let open = '';
      let close = '';
      for (let i = 0; i < 15; i++) {
        open += `<div class="level-${i}">`;
        close = '</div>' + close;
      }
      const input = `${open}content${close}`;
      const ast = parse(input);
      expect(ast).toHaveLength(1);
      expect((ast[0] as HtmlNode).tag).toBe('div');
    });

    it('handles deeply nested divs with switch and include', () => {
      const input = [
        '<div class="layout">',
        '  <div class="header"><h2>Title</h2></div>',
        '  <div class="body">',
        '    <div class="sidebar">',
        '      <div class="nav">',
        '        <div class="nav-item"><a>Home</a></div>',
        '        <div class="nav-item"><a>Settings</a></div>',
        '      </div>',
        '    </div>',
        '    <div class="content">',
        '      <div class="content-inner">',
        '        {switch $mode}',
        '          {case "overview"}',
        '            {include "Overview"}',
        '          {case "details"}',
        '            {include "Details"}',
        '        {/switch}',
        '      </div>',
        '    </div>',
        '  </div>',
        '</div>',
      ].join('\n');

      const ast = parse(input);
      expect(ast).toHaveLength(1);
    });
  });

  describe('attribute parsing edge cases', () => {
    it('parses tags with colon-prefixed attributes', () => {
      const input = '<div xml:lang="en">content</div>';
      const ast = parse(input);
      expect(ast).toHaveLength(1);
      expect((ast[0] as HtmlNode).tag).toBe('div');
    });

    it('parses tags with data- attributes containing dots', () => {
      const input = '<div data-v-abc123>content</div>';
      const ast = parse(input);
      expect(ast).toHaveLength(1);
    });

    it('parses nested divs where inner has non-standard attribute', () => {
      const input =
        '<div class="outer"><div :class="active">content</div></div>';
      const ast = parse(input);
      expect(ast).toHaveLength(1);
      expect((ast[0] as HtmlNode).tag).toBe('div');
    });

    it('parses nested divs where inner has @-prefixed attribute', () => {
      const input =
        '<div class="outer"><div @click="handler">content</div></div>';
      const ast = parse(input);
      expect(ast).toHaveLength(1);
    });

    it('parses tags with interpolation in quoted attribute value', () => {
      const input =
        '<div class="{$mode}"><div class="inner">content</div></div>';
      const ast = parse(input);
      expect(ast).toHaveLength(1);
    });
  });

  describe('DOM rendering with {include}', () => {
    beforeEach(() => {
      const storyData = makeStoryData([
        makePassage(1, 'Start', 'Start'),
        makePassage(2, 'DialogShell', shellContent),
        makePassage(3, 'DialogSidebar', sidebarContent),
      ]);
      useStoryStore.getState().init(storyData);
    });

    it('renders DialogShell with {include} + global nobr', () => {
      useStoryStore.setState({ nobr: true });

      const passage = useStoryStore
        .getState()
        .storyData!.passages.get('DialogShell')!;
      const container = document.createElement('div');
      render(
        <NobrContext.Provider value={true}>
          <Passage passage={passage} />
        </NobrContext.Provider>,
        container,
      );
      expect(container.textContent).toContain('Header');
      expect(container.textContent).toContain('Home');
      expect(container.textContent).toContain('Content here');
    });

    it('renders via PassageDialog-like flow with nobr', () => {
      useStoryStore.setState({ nobr: true });

      const container = document.createElement('div');
      const tokens = tokenize(shellContent);
      const ast = buildAST(tokens);

      render(
        <NobrContext.Provider value={true}>
          {renderNodes(ast)}
        </NobrContext.Provider>,
        container,
      );
      expect(container.textContent).toContain('Header');
      expect(container.textContent).toContain('Home');
      expect(container.textContent).toContain('Content here');
    });
  });
});
