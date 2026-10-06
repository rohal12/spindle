// @vitest-environment happy-dom
/**
 * Syntax errors in code, as a passage shows them where the code runs: the
 * reason, its column in the code, and the code's line marked there.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { Passage } from '../../src/components/Passage';
import { useStoryStore } from '../../src/store';
import type { StoryData, Passage as PassageData } from '../../src/parser';

function makePassage(pid: number, name: string, content: string): PassageData {
  return { pid, name, tags: [], metadata: {}, content };
}

function makeStoryData(passages: PassageData[]): StoryData {
  return {
    name: 'Test',
    startNode: 1,
    ifid: 'test',
    format: 'spindle',
    formatVersion: '0.1.0',
    passages: new Map(passages.map((p) => [p.name, p])),
    passagesById: new Map(passages.map((p) => [p.pid, p])),
    userCSS: '',
    userScript: '',
  };
}

/** The text of the errors a passage shows. */
function shownErrors(content: string): string[] {
  const el = document.createElement('div');
  act(() => {
    render(<Passage passage={makePassage(1, 'Test', content)} />, el);
  });
  return [...el.querySelectorAll('.error')].map((e) => e.textContent ?? '');
}

describe('syntax errors shown in place', () => {
  beforeEach(() => {
    useStoryStore
      .getState()
      .init(makeStoryData([makePassage(1, 'Start', 'Start')]), { gold: 5 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [
      '{if $gold > }plenty{/if}',
      '{if error: Unexpected end of code at column 8: $gold >▶}',
    ],
    [
      '{set $name = "Bob}',
      '{set error: Unterminated string constant at column 9: $name = ▶"Bob}',
    ],
    [
      '{print ($gold + $count}',
      '{print error: Unexpected end of code at column 16: ($gold + $count▶ (missing ")" for the "(" at column 1)}',
    ],
    [
      '{print $gold $count}',
      '{print error: Unexpected "$count" at column 7: $gold ▶$count}',
    ],
    [
      '{set $list = [1, 2}',
      '{set error: Unexpected end of code at column 14: $list = [1, 2▶ (missing "]" for the "[" at column 9)}',
    ],
    [
      '{set let _x = 1}',
      `{set error: "_x" is a temporary variable and can't be declared at column 5: let ▶_x = 1}`,
    ],
  ])('%j', (content, message) => {
    expect(shownErrors(content)).toEqual([message]);
  });
});
