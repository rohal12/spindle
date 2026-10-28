import type { Mode, StringStream } from 'codemirror';
import {
  highlightSpans,
  highlightWithOpenStart,
  openConstructStart,
  type StyledSpan,
} from './highlight';

/** How many lines the mode looks ahead for a construct to close. */
export const LOOK_AHEAD_LINES = 200;

export interface ModeState {
  /** Enclosing block/element openers, without their previous body text. */
  context: string;
  /**
   * The text of a construct still open at the end of the previous line,
   * from its start, ending in a line break; `''` when nothing is open.
   */
  tail: string;
  /** The spans left to emit on the current line, in window offsets. */
  spans: StyledSpan[];
  /** Where the current line starts in the window its spans came from. */
  lineStart: number;
  /**
   * The open construct did not close within the look-ahead: it is treated
   * as unclosed, `tail` keeps only its first line and lines no longer look
   * ahead until it closes.
   */
  capped: boolean;
}

/** True when a construct open at the end of `text` started before `end`. */
function openAcross(text: string, end: number): boolean {
  const start = openConstructStart(text);
  return start >= 0 && start < end;
}

/**
 * `head` (the tail and the line) with as many following lines as it takes
 * to close the construct open at the line's end. If it does not close
 * within the look-ahead, the result is `head` alone and `capped`. Lines are
 * read only as needed: CodeMirror re-reads a line when any line it looked
 * ahead to changes.
 */
function lookAhead(
  stream: StringStream,
  head: string,
): { text: string; capped: boolean } {
  const lines: string[] = [];
  /** Read up to `count` lines ahead; false where the passage ends first. */
  const readAhead = (count: number) => {
    while (lines.length < count) {
      const line = stream.lookAhead(lines.length + 1);
      if (line === undefined) return false;
      lines.push(line);
    }
    return true;
  };
  // Grow the window by doubling: the cost stays within twice the final one.
  for (let count = 1; ; count = Math.min(count * 2, LOOK_AHEAD_LINES)) {
    const more = readAhead(count);
    const text = [head, ...lines].join('\n');
    // Closed, or open to the end of the passage: as the whole passage is.
    if (!openAcross(text, head.length) || !more) {
      return { text, capped: false };
    }
    if (count >= LOOK_AHEAD_LINES) return { text: head, capped: true };
  }
}

/** Read the current line's spans and the tail for the next line. */
function startLine(stream: StringStream, state: ModeState): void {
  const lineStart = state.context.length + state.tail.length;
  const head = state.context + state.tail + stream.string;
  const line = highlightWithOpenStart(head);
  const open = line.openStart;
  let spans = line.spans;
  // A capped construct still open: no look-ahead until it closes.
  let capped = state.capped && open === state.context.length;
  if (open >= 0 && !capped) {
    const window = lookAhead(stream, head);
    capped = window.capped;
    if (window.text !== head) spans = highlightSpans(window.text);
  }
  state.spans = spans
    .filter((span) => span.end > lineStart && span.start < head.length)
    .map((span) => ({
      start: Math.max(span.start, lineStart),
      end: Math.min(span.end, head.length),
      style: span.style,
    }));
  state.lineStart = lineStart;
  state.capped = capped;
  state.context = line.context;
  const rest = open < 0 ? '' : head.slice(open);
  // A capped tail keeps the construct's first line only, so the cost per
  // line stays flat however long it stays open.
  const kept = capped ? rest.split('\n', 1)[0]! : rest;
  state.tail = open < 0 ? '' : `${kept}\n`;
}

/**
 * The CodeMirror 5 mode for Spindle passages. Each line is styled as
 * `highlightSpans` styles the whole passage, for constructs that close
 * within `LOOK_AHEAD_LINES` lines.
 */
export function mode(): Mode<ModeState> {
  return {
    name: 'spindle',
    startState: () => ({
      context: '',
      tail: '',
      spans: [],
      lineStart: 0,
      capped: false,
    }),
    copyState: (state) => ({ ...state, spans: [...state.spans] }),
    blankLine: (state) => {
      if (state.tail) state.tail += '\n';
    },
    token: (stream, state) => {
      try {
        if (stream.sol() && state.spans.length === 0) startLine(stream, state);
        const span = state.spans[0];
        if (!span) {
          stream.skipToEnd();
          return null;
        }
        const pos = state.lineStart + stream.pos;
        if (pos < span.start) {
          stream.pos = span.start - state.lineStart;
          return null;
        }
        state.spans.shift();
        stream.pos = span.end - state.lineStart;
        return span.style;
      } catch {
        stream.skipToEnd();
        state.spans = [];
        state.tail = '';
        state.context = '';
        state.capped = false;
        return null;
      }
    },
  };
}
