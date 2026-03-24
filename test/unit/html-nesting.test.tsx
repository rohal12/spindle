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

describe('issue #109: <button> elements should not be HTML-escaped', () => {
  it('tokenizes <button> as an HtmlNode', () => {
    const ast = parse('<button>Click me</button>');
    expect(ast).toHaveLength(1);
    expect((ast[0] as HtmlNode).type).toBe('html');
    expect((ast[0] as HtmlNode).tag).toBe('button');
  });

  it('tokenizes <button> with attributes', () => {
    const ast = parse('<button class="action" disabled>Go</button>');
    expect(ast).toHaveLength(1);
    expect((ast[0] as HtmlNode).tag).toBe('button');
    expect((ast[0] as HtmlNode).attributes['class']).toBe('action');
  });

  it('renders <button> inside {for} loop in nobr context', () => {
    const storyData = makeStoryData([
      makePassage(
        1,
        'Start',
        '{for @item of $items}<button>{@item.name}</button>{/for}',
        ['nobr'],
      ),
    ]);
    useStoryStore.getState().init(storyData);
    useStoryStore.setState({ nobr: true });
    useStoryStore
      .getState()
      .setVariable('items', [{ name: 'Test' }, { name: 'Other' }]);

    const passage = useStoryStore.getState().storyData!.passages.get('Start')!;
    const container = document.createElement('div');
    render(
      <NobrContext.Provider value={true}>
        <Passage passage={passage} />
      </NobrContext.Provider>,
      container,
    );

    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].textContent).toBe('Test');
    expect(buttons[1].textContent).toBe('Other');
    // Ensure no escaped HTML
    expect(container.innerHTML).not.toContain('&lt;button');
  });
});

describe('issue #113: SVG with multi-line tags renders as escaped plaintext', () => {
  it('parses multi-line <svg> into HtmlNode tree', () => {
    const input =
      '<svg\n  class="icon">\n  <rect width="10" height="10"/>\n</svg>';
    const ast = parse(input);
    expect(ast).toHaveLength(1);
    expect((ast[0] as HtmlNode).type).toBe('html');
    expect((ast[0] as HtmlNode).tag).toBe('svg');
    expect((ast[0] as HtmlNode).attributes['class']).toBe('icon');
  });

  it('parses <svg> nested inside <div>', () => {
    const input = '<div><svg><circle r="5"/></svg></div>';
    const ast = parse(input);
    expect(ast).toHaveLength(1);
    const div = ast[0] as HtmlNode;
    expect(div.tag).toBe('div');
    const svg = div.children.find(
      (c) => c.type === 'html' && c.tag === 'svg',
    ) as HtmlNode;
    expect(svg).toBeDefined();
    expect(svg.tag).toBe('svg');
  });

  it('renders multi-line <svg> as DOM element, not escaped text', () => {
    const storyData = makeStoryData([
      makePassage(
        1,
        'Start',
        '<div><svg\n  class="icon">\n  <circle r="5"/>\n</svg></div>',
      ),
    ]);
    useStoryStore.getState().init(storyData);

    const passage = useStoryStore.getState().storyData!.passages.get('Start')!;
    const container = document.createElement('div');
    render(<Passage passage={passage} />, container);

    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg!.getAttribute('class')).toBe('icon');
    expect(svg!.querySelector('circle')).not.toBeNull();
    // Must not contain escaped HTML
    expect(container.innerHTML).not.toContain('&lt;svg');
    expect(container.innerHTML).not.toContain('&lt;circle');
  });
});

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

    it('parses {if} block macro inside double-quoted attribute value', () => {
      const input =
        '<div class="{if $active}highlighted{else}normal{/if}">content</div>';
      const ast = parse(input);
      expect(ast).toHaveLength(1);
      expect((ast[0] as HtmlNode).tag).toBe('div');
      expect((ast[0] as HtmlNode).attributes['class']).toBe(
        '{if $active}highlighted{else}normal{/if}',
      );
    });

    it('parses {if} with quoted expression inside attribute value', () => {
      const input =
        '<div class="{if $x == \\"foo\\"}active{/if}">content</div>';
      const ast = parse(input);
      expect(ast).toHaveLength(1);
      expect((ast[0] as HtmlNode).tag).toBe('div');
    });

    it('parses nested braces with {if}/{else} inside attribute value', () => {
      const input =
        '<div class="{if $x == \\"foo\\"}active{else}inactive{/if}">content</div>';
      const ast = parse(input);
      expect(ast).toHaveLength(1);
      expect((ast[0] as HtmlNode).tag).toBe('div');
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
