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

    const passage = makePassage(2, 'Test', content, ['nobr']);
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start'),
      passage,
    ]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().setVariable(
      'items',
      Array.from({ length: 20 }, (_, i) => ({
        id: `item-${i}`,
        name: `Research ${i}`,
        status: i % 3 === 0 ? 'active' : 'locked',
        effects: `+${i} bonus`,
      })),
    );
    useStoryStore.getState().navigate('Test');

    // Warm up
    const warmupContainer = document.createElement('div');
    render(<Passage passage={passage} />, warmupContainer);

    // Benchmark
    const iterations = 50;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const c = document.createElement('div');
      render(<Passage passage={passage} />, c);
    }
    const elapsed = performance.now() - start;
    const perRender = elapsed / iterations;

    // Verify correctness
    const container = document.createElement('div');
    render(<Passage passage={passage} />, container);
    expect(container.querySelectorAll('.card').length).toBe(20);
    expect(container.querySelector('.header-id')!.textContent).toBe('ALMA');
    expect(container.querySelectorAll('.nav-item').length).toBe(7);

    console.log(
      `ALMA-like UI: ${perRender.toFixed(2)}ms/render (${iterations} iterations, ${elapsed.toFixed(0)}ms total)`,
    );
  });

  it('worst case: many small HTML elements with short text labels', () => {
    const content =
      '{for @label of $labels}<div class="cell">{@label}</div>{/for}';

    const passage = makePassage(2, 'Test', content, ['nobr']);
    const storyData = makeStoryData([
      makePassage(1, 'Start', 'Start'),
      passage,
    ]);
    useStoryStore.getState().init(storyData);
    useStoryStore.getState().setVariable(
      'labels',
      Array.from({ length: 100 }, (_, i) => `Label ${i}`),
    );
    useStoryStore.getState().navigate('Test');

    // Warm up
    const warmupContainer = document.createElement('div');
    render(<Passage passage={passage} />, warmupContainer);

    const iterations = 20;
    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const c = document.createElement('div');
      render(<Passage passage={passage} />, c);
    }
    const elapsed = performance.now() - start;
    const perRender = elapsed / iterations;

    const container = document.createElement('div');
    render(<Passage passage={passage} />, container);
    expect(container.querySelectorAll('.cell').length).toBe(100);

    console.log(
      `100 HTML elements with text: ${perRender.toFixed(2)}ms/render (${iterations} iterations, ${elapsed.toFixed(0)}ms total)`,
    );
  });
});
