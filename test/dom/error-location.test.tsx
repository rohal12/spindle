// @vitest-environment happy-dom
// Errors in {do} and {goto} name the passage the macro is in, also when the
// code navigated to another passage before failing.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'preact';
import { Passage } from '../../src/components/Passage';
import { useStoryStore, _resetRuntimePhase } from '../../src/store';
import { installStoryAPI } from '../../src/story-api';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content = ''): PassageData {
  return {
    pid,
    name,
    tags: [],
    metadata: {
      'data-source-file': 'story.twee',
      'data-source-line': String(pid * 10),
    },
    content,
  };
}

function storyData(passages: PassageData[]): StoryData {
  return {
    name: 'Error locations',
    startNode: 1,
    ifid: 'error-location',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

/** Render `content` as the current passage, Start (story.twee:10). */
function renderAsStart(content: string): void {
  const start = makePassage(1, 'Start', content);
  const room = makePassage(2, 'Room');
  _resetRuntimePhase();
  sessionStorage.clear();
  useStoryStore.getState().init(storyData([start, room]));
  installStoryAPI();
  render(<Passage passage={start} />, document.createElement('div'));
}

describe('error locations', () => {
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    error = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => error.mockRestore());

  const logged = () =>
    error.mock.calls.map((args: unknown[]) => String(args[0])).join('\n');

  it('{goto} names its own passage when the navigation fails', () => {
    renderAsStart('{set $cb = () => 1}{goto "Room"}');
    expect(useStoryStore.getState().currentPassage).toBe('Room');
    expect(logged()).toContain('Error in {goto} (story.twee:10)');
    expect(logged()).not.toContain('story.twee:20');
  });

  it('{do} names its own passage when its code navigated before failing', () => {
    renderAsStart('{do}Story.goto("Room"); throw new Error("boom");{/do}');
    expect(useStoryStore.getState().currentPassage).toBe('Room');
    expect(logged()).toContain('Error in {do} (story.twee:10)');
    expect(logged()).not.toContain('story.twee:20');
  });

  it('{set} names its own passage when its code navigated before failing', () => {
    renderAsStart('{set $x = (Story.goto("Room"), undefinedName)}');
    expect(useStoryStore.getState().currentPassage).toBe('Room');
    expect(logged()).toMatch(/Error in \{set [^}]*\} \(story\.twee:10\)/);
    expect(logged()).not.toContain('story.twee:20');
  });
});
