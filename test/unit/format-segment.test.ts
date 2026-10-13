import { describe, it, expect } from 'vitest';
import { segmentRegions } from '../../src/format/segment';

describe('segmentRegions', () => {
  it('classifies plain Spindle lines as spindle regions', () => {
    const regions = segmentRegions('{if $x}\ncontent\n{/if}\n');
    expect(regions).toHaveLength(1);
    expect(regions[0]!.type).toBe('spindle');
  });

  it('detects inline <script> blocks', () => {
    const input = 'text\n<script>\nconst x = 1;\n</script>\nmore\n';
    const regions = segmentRegions(input);
    const types = regions.map((r) => r.type);
    expect(types).toContain('script');
    expect(types.filter((t) => t === 'spindle')).toHaveLength(2);
  });

  it('ends a <script> region at a closing tag on the opening line', () => {
    const input = '<script>console.log(1)</script>\nHello\nWorld\n';
    const regions = segmentRegions(input);
    expect(regions).toEqual([
      { type: 'script', lines: ['<script>console.log(1)</script>'] },
      { type: 'spindle', lines: ['Hello', 'World'] },
    ]);
  });

  it('keeps a later <script> block separate from a same-line script', () => {
    const input =
      '<script src="a.js"></script>\ntext\n<script>\nfoo()\n</script>\n';
    const regions = segmentRegions(input);
    expect(regions.map((r) => r.type)).toEqual(['script', 'spindle', 'script']);
    expect(regions[2]!.lines).toEqual(['<script>', 'foo()', '</script>']);
  });

  it('detects multi-line HTML blocks', () => {
    const input = '{if $x}\n<div>\n  <span>text</span>\n</div>\n{/if}\n';
    const regions = segmentRegions(input);
    const types = regions.map((r) => r.type);
    expect(types).toContain('html');
  });

  it('does NOT treat single-line inline HTML as HTML block', () => {
    const input = 'text <em>bold</em> more\n';
    const regions = segmentRegions(input);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.type).toBe('spindle');
  });

  it('does NOT treat single-line HTML tags starting a line as HTML block', () => {
    const input = '<br>\n{set $x = 1}\n';
    const regions = segmentRegions(input);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.type).toBe('spindle');
  });

  it('detects multi-line HTML starting with non-void tag', () => {
    const input = '<div class="foo">\n  <p>hello</p>\n</div>\n';
    const regions = segmentRegions(input);
    expect(regions[0]!.type).toBe('html');
  });
});
