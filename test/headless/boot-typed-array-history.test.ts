// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { bootStory } from '../../src/headless';
import { storyHtml } from './story-html';

// Separate file: Spindle's module state allows one story per module instance.
describe('typed arrays read through Story.get()', () => {
  it('cannot change recorded history (#429)', async () => {
    const Story = await bootStory({
      html: storyHtml({
        StoryVariables: '$bytes = null\n$view = null\n$raw = null',
        StoryInit: '{set $bytes = new Uint8Array([100])}',
        Start: '{$bytes[0]}\n[[Second]]',
        Second: '{$bytes[0]}',
      }),
    });
    await Story.waitForActions();
    Story.goto('Second');
    await Story.waitForActions();

    const bytes = Story.get('bytes') as Uint8Array;
    bytes.fill(80);
    // The write reached neither the store nor the recorded Start moment
    expect([...(Story.get('bytes') as Uint8Array)]).toEqual([100]);
    Story.back();
    await Story.waitForActions();
    expect(Story.passage).toBe('Start');
    expect([...(Story.get('bytes') as Uint8Array)]).toEqual([100]);
  });

  it('isolates DataViews and ArrayBuffers too', async () => {
    const buffer = new Uint8Array([1, 2]).buffer;
    window.Story.set({ view: new DataView(buffer), raw: buffer.slice(0) });
    await window.Story.waitForActions();
    (window.Story.get('view') as DataView).setUint8(0, 9);
    new Uint8Array(window.Story.get('raw') as ArrayBuffer)[0] = 9;
    expect((window.Story.get('view') as DataView).getUint8(0)).toBe(1);
    expect(new Uint8Array(window.Story.get('raw') as ArrayBuffer)[0]).toBe(1);
  });
});
