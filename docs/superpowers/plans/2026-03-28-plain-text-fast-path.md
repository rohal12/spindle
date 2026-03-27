# Plain Text Fast Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skip micromark + innerHTML for plain text without markdown syntax in `renderNodes`, eliminating ~54% of remaining click time (288ms → ~80-100ms).

**Architecture:** Add a detection regex and `buildPlainTextVnodes` helper in `src/markup/render.tsx`. After the combined string is built, strip placeholders, test for markdown syntax characters. If none found, split on placeholders and build vnodes directly. Falls through to existing pipeline on any match.

**Tech Stack:** Preact, TypeScript, Vitest (happy-dom)

---

### Task 1: Write failing tests for plain text fast path correctness

**Files:**

- Create: `test/dom/render-plain-text.test.tsx`

These tests exercise `renderNodes` directly through tokenize → buildAST → renderNodes. They should pass both before and after the implementation (the fast path must produce identical output to the existing pipeline).

- [ ] **Step 1: Create the test file with correctness tests**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { tokenize } from '../../src/markup/tokenizer';
import { buildAST } from '../../src/markup/ast';
import { renderNodes } from '../../src/markup/render';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): Passage {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: Passage[], startNode = 1): StoryData {
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

function renderMarkup(
  markup: string,
  options?: { nobr?: boolean },
): HTMLElement {
  const tokens = tokenize(markup);
  const ast = buildAST(tokens);
  const container = document.createElement('div');
  render(<>{renderNodes(ast, options)}</>, container);
  return container;
}

describe('plain text fast path (issue #145)', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  describe('correctly renders plain text without markdown pipeline', () => {
    it('plain text in nobr mode', () => {
      const el = renderMarkup('Hello World', { nobr: true });
      expect(el.textContent).toBe('Hello World');
    });

    it('plain text with variable placeholder', () => {
      useStoryStore.getState().setVariable('name', 'ALMA');
      const el = renderMarkup('Name: {$name}', { nobr: true });
      expect(el.textContent).toBe('Name: ALMA');
    });

    it('Unicode symbols (not markdown syntax)', () => {
      const el = renderMarkup('▸ Menu ✕ Close', { nobr: true });
      expect(el.textContent).toBe('▸ Menu ✕ Close');
    });

    it('emoji content', () => {
      const el = renderMarkup('🔒 Locked', { nobr: true });
      expect(el.textContent).toBe('🔒 Locked');
    });

    it('text with colons, commas, slashes (non-markdown punctuation)', () => {
      const el = renderMarkup('Requires: Level 2, Policy / Tier 3', {
        nobr: true,
      });
      expect(el.textContent).toBe('Requires: Level 2, Policy / Tier 3');
    });

    it('text with parentheses and equals', () => {
      const el = renderMarkup('Speed (km/h) = 100', { nobr: true });
      expect(el.textContent).toBe('Speed (km/h) = 100');
    });

    it('bare exclamation mark is not markdown', () => {
      const el = renderMarkup('Activate!', { nobr: true });
      expect(el.textContent).toBe('Activate!');
    });

    it('multiple variables interleaved with text', () => {
      useStoryStore.getState().setVariable('a', 'Alpha');
      useStoryStore.getState().setVariable('b', 'Beta');
      const el = renderMarkup('{$a} and {$b}', { nobr: true });
      expect(el.textContent).toBe('Alpha and Beta');
    });

    it('HTML element children with plain text', () => {
      const el = renderMarkup(
        '<div class="box"><span class="label">Hello</span></div>',
        { nobr: true },
      );
      expect(el.querySelector('.label')!.textContent).toBe('Hello');
    });
  });

  describe('non-nobr wraps in <p>', () => {
    it('plain text without nobr gets <p> wrapper', () => {
      const el = renderMarkup('Just some text');
      const p = el.querySelector('p');
      expect(p).not.toBeNull();
      expect(p!.textContent).toBe('Just some text');
    });

    it('plain text with variable without nobr', () => {
      useStoryStore.getState().setVariable('name', 'ALMA');
      const el = renderMarkup('Hello {$name}');
      const p = el.querySelector('p');
      expect(p).not.toBeNull();
      expect(p!.textContent).toBe('Hello ALMA');
    });
  });

  describe('falls through to markdown for syntax-bearing text', () => {
    it('emphasis with asterisks', () => {
      const el = renderMarkup('This is *important* text');
      expect(el.querySelector('em')!.textContent).toBe('important');
    });

    it('emphasis with underscores', () => {
      const el = renderMarkup('This is _emphasized_ text');
      expect(el.querySelector('em')!.textContent).toBe('emphasized');
    });

    it('inline code', () => {
      const el = renderMarkup('Use `console.log` here');
      expect(el.querySelector('code')!.textContent).toBe('console.log');
    });

    it('heading', () => {
      const el = renderMarkup('# Title');
      expect(el.querySelector('h1')!.textContent).toBe('Title');
    });

    it('link syntax', () => {
      const el = renderMarkup('See [docs](http://example.com)');
      const link = el.querySelector('a');
      expect(link).not.toBeNull();
      expect(link!.textContent).toBe('docs');
    });

    it('GFM strikethrough', () => {
      const el = renderMarkup('This is ~~deleted~~ text');
      expect(el.querySelector('del')!.textContent).toBe('deleted');
    });

    it('backslash escape', () => {
      const el = renderMarkup('Price\\: free');
      expect(el.textContent).toContain('Price');
    });

    it('unordered list item', () => {
      const el = renderMarkup('- Item 1\n- Item 2');
      expect(el.querySelector('ul')).not.toBeNull();
    });

    it('ordered list item', () => {
      const el = renderMarkup('1. First\n2. Second');
      expect(el.querySelector('ol')).not.toBeNull();
    });

    it('image syntax', () => {
      const el = renderMarkup('![alt](http://example.com/img.png)');
      expect(el.querySelector('img')).not.toBeNull();
    });

    it('blockquote', () => {
      const el = renderMarkup('> quoted text');
      expect(el.querySelector('blockquote')).not.toBeNull();
    });

    it('GFM table', () => {
      const el = renderMarkup('| A | B |\n| --- | --- |\n| 1 | 2 |');
      expect(el.querySelector('table')).not.toBeNull();
    });

    it('blank lines create paragraphs', () => {
      const el = renderMarkup('Para 1\n\nPara 2');
      expect(el.querySelectorAll('p').length).toBeGreaterThanOrEqual(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass (baseline)**

These tests verify existing behavior — they should all pass before any implementation changes.

Run: `npx vitest run test/dom/render-plain-text.test.tsx`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add test/dom/render-plain-text.test.tsx
git commit -m "test: add correctness baseline tests for renderNodes plain text fast path (#145)"
```

---

### Task 2: Implement the plain text fast path

**Files:**

- Modify: `src/markup/render.tsx:268-315`

- [ ] **Step 1: Add the detection regex constants and `buildPlainTextVnodes` helper**

Add these above the `renderNodes` function (before line 268), after the `getVariableTextValue` function:

```tsx
/**
 * Characters/patterns that trigger CommonMark or GFM transformations.
 * Any match → fall through to the full micromark pipeline.
 * False positives (e.g. `-` used as text, not list) just use the slower path.
 */
const MARKDOWN_SYNTAX_RE = /[*_`#|~\[>\\\-]|!\[|\d+\./;
const BLANK_LINE_RE = /\n\s*\n/;
const PLACEHOLDER_SPLIT_RE = /(<span data-tw="\d+"><\/span>)/;
const PLACEHOLDER_IDX_RE = /^<span data-tw="(\d+)"><\/span>$/;
const PLACEHOLDER_STRIP_RE = /<span data-tw="\d+"><\/span>/g;

/**
 * Build Preact vnodes from a combined string that contains only plain text
 * and <span data-tw="N"></span> placeholders. No micromark, no innerHTML.
 */
function buildPlainTextVnodes(
  combined: string,
  components: preact.ComponentChildren[],
  nobr?: boolean,
): preact.ComponentChildren {
  const parts = combined.split(PLACEHOLDER_SPLIT_RE);
  const children: preact.ComponentChildren[] = [];
  for (const part of parts) {
    const m = PLACEHOLDER_IDX_RE.exec(part);
    if (m) {
      children.push(components[parseInt(m[1]!, 10)]);
    } else if (part) {
      children.push(part);
    }
  }
  return nobr ? <>{children}</> : h('p', null, ...children);
}
```

- [ ] **Step 2: Insert the fast path check in `renderNodes`**

In `renderNodes`, after the combined string loop (after the `for` loop ending at line 308), and before the `markdownToHtml` call (line 311), add:

Replace this block in `renderNodes`:

```tsx
// Run combined text through markdown
const html = markdownToHtml(combined, { inline: options?.inline });

// Convert HTML to Preact VNodes, replacing placeholders with components
return htmlToPreact(html, components, options?.nobr);
```

With:

```tsx
// Fast path: skip micromark + innerHTML when text has no markdown syntax.
// This eliminates ~655 innerHTML calls on plain UI text like "ALMA",
// "▸ Crew", "Activate" that pass through the full pipeline only to
// produce the same text they started with (issue #145).
const textOnly = combined.replace(PLACEHOLDER_STRIP_RE, '');
if (!MARKDOWN_SYNTAX_RE.test(textOnly) && !BLANK_LINE_RE.test(textOnly)) {
  return buildPlainTextVnodes(combined, components, options?.nobr);
}

// Run combined text through markdown
const html = markdownToHtml(combined, { inline: options?.inline });

// Convert HTML to Preact VNodes, replacing placeholders with components
return htmlToPreact(html, components, options?.nobr);
```

- [ ] **Step 3: Run the type checker**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run all tests**

Run: `npx vitest run`
Expected: All tests PASS (both new and existing)

- [ ] **Step 5: Commit**

```bash
git add src/markup/render.tsx
git commit -m "fix: skip micromark + innerHTML for plain text without markdown syntax (#145)"
```

---

### Task 3: Add benchmark test

**Files:**

- Create: `test/dom/render-plain-text-bench.test.tsx`

This is a separate file so it can be run independently. It measures the performance impact of the fast path with an ALMA-like UI structure.

- [ ] **Step 1: Create the benchmark test**

```tsx
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

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

describe('renderNodes plain-text fast path benchmark', () => {
  beforeEach(() => {
    const store = useStoryStore.getState();
    store.init(makeStoryData([makePassage(1, 'Start', 'Start')]));
  });

  it('ALMA-like UI passage with nested HTML + plain text labels', () => {
    useStoryStore.getState().setVariable(
      'items',
      Array.from({ length: 20 }, (_, i) => ({
        id: `item-${i}`,
        name: `Research ${i}`,
        status: i % 3 === 0 ? 'active' : 'locked',
        effects: `+${i} bonus`,
      })),
    );

    const content = [
      '<div class="alma-dialog">',
      '  <div class="header">',
      '    <span class="header-id">ALMA</span>',
      '    <span class="close">✕</span>',
      '  </div>',
      '  <div class="sidebar">',
      '    <div class="nav-item">Home</div>',
      '    <div class="nav-item">Crew</div>',
      '    <div class="nav-item">Colony</div>',
      '    <div class="nav-item">▸ Research</div>',
      '    <div class="nav-item">▸ Policies</div>',
      '    <div class="nav-item">Construction</div>',
      '    <div class="nav-item">Settings</div>',
      '  </div>',
      '  <div class="content">',
      '    <span class="title">Research Tree</span>',
      '    {for @node of $items}',
      '    <div class="card">',
      '      <div class="card-header">',
      '        <span class="icon"></span>',
      '        <span class="name">{@node.name}</span>',
      '      </div>',
      '      <div class="card-body">',
      '        <span class="effects">{@node.effects}</span>',
      '        {if @node.status == "active"}',
      '        <button class="btn">Activate</button>',
      '        {/if}',
      '      </div>',
      '    </div>',
      '    {/for}',
      '  </div>',
      '</div>',
    ].join('\n');

    const passage = makePassage(1, 'Test', content, ['nobr']);
    const storyData = makeStoryData([passage]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().show(1);

    const container = document.createElement('div');

    // Warm up
    render(<Passage passage={passage} />, container);
    container.innerHTML = '';

    // Benchmark
    const iterations = 50;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      render(<Passage passage={passage} />, container);
      container.innerHTML = '';
    }
    const elapsed = performance.now() - start;
    const perRender = elapsed / iterations;

    // Verify correctness
    render(<Passage passage={passage} />, container);
    expect(container.querySelectorAll('.card').length).toBe(20);
    expect(container.querySelector('.header-id')!.textContent).toBe('ALMA');
    expect(container.querySelectorAll('.nav-item').length).toBe(7);

    console.log(
      `ALMA-like UI: ${perRender.toFixed(2)}ms/render (${iterations} iterations, ${elapsed.toFixed(0)}ms total)`,
    );
  });

  it('worst case: many small HTML elements with short text labels', () => {
    const items = Array.from({ length: 100 }, (_, i) => `Label ${i}`);
    useStoryStore.getState().setVariable('labels', items);

    const content =
      '{for @label of $labels}<div class="cell">{@label}</div>{/for}';

    const passage = makePassage(1, 'Test', content, ['nobr']);
    const storyData = makeStoryData([passage]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().show(1);

    const container = document.createElement('div');

    // Warm up
    render(<Passage passage={passage} />, container);
    container.innerHTML = '';

    const iterations = 20;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      render(<Passage passage={passage} />, container);
      container.innerHTML = '';
    }
    const elapsed = performance.now() - start;
    const perRender = elapsed / iterations;

    render(<Passage passage={passage} />, container);
    expect(container.querySelectorAll('.cell').length).toBe(100);

    console.log(
      `100 HTML elements with text: ${perRender.toFixed(2)}ms/render (${iterations} iterations, ${elapsed.toFixed(0)}ms total)`,
    );
  });
});
```

- [ ] **Step 2: Run the benchmark**

Run: `npx vitest run test/dom/render-plain-text-bench.test.tsx`
Expected: PASS, console output shows ms/render timings

- [ ] **Step 3: Commit**

```bash
git add test/dom/render-plain-text-bench.test.tsx
git commit -m "test: add benchmark for renderNodes plain text fast path (#145)"
```

---

### Task 4: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 2: Run type checker**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Verify the fast path is actually being hit**

Add a temporary `console.log` in `buildPlainTextVnodes` and run the ALMA benchmark to confirm the fast path fires. Then remove the console.log.

Alternatively, check that the benchmark shows measurable improvement compared to a baseline (comment out the fast path check, run benchmark, restore, run again, compare).
