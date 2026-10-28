import { describe, expect, it } from 'vitest';
import { test, fc } from '@fast-check/vitest';
import { highlightSpans } from '../../src/twine-editor/highlight';
import { runLines } from '../support/twine-editor-mode';
import { fcOptions } from './config';
import {
  markupNoise,
  mutatedPassage,
  passageArb,
  propTimeout,
} from './markup-arbitraries';

/** `highlightSpans(text)` cut at line breaks, as [line, token text, style]. */
function spansByLine(text: string): [number, string, string][] {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    starts.push(i + 1);
  }
  const pieces: [number, string, string][] = [];
  for (const span of highlightSpans(text)) {
    starts.forEach((lineStart, line) => {
      const lineEnd = (starts[line + 1] ?? text.length + 1) - 1;
      const start = Math.max(span.start, lineStart);
      const end = Math.min(span.end, lineEnd);
      if (start < end) pieces.push([line, text.slice(start, end), span.style]);
    });
  }
  return pieces;
}

const passage = fc
  .oneof(
    passageArb.map((g) => g.src),
    mutatedPassage,
    markupNoise,
  )
  // CodeMirror splits lines at \r too; compare passages with \n breaks only.
  .map((text) => text.replace(/\r\n?/g, '\n'));

describe('Spindle CodeMirror mode', () => {
  it('retains branch ownership across multiline macro arguments (#699)', () => {
    const text =
      '{.a-{$A} if "q\\"}"}.- switch}<li>aa</li >{.A-A.a-{$A}.aaa-{$A} case\n<_, don\'t}\\{\\{aa{.Aa.__.--000- default}{/switch }{.a_A- elseif "aaaa"}\\{{/if\n}';
    const styled = runLines(text).filter(
      (token): token is [number, string, string] => token[2] !== null,
    );
    expect(styled).toEqual(spansByLine(text));
  });

  test.prop([passage], fcOptions)(
    'styles each line as highlightSpans styles the whole passage',
    (text) => {
      const styled = runLines(text).filter(
        (token): token is [number, string, string] => token[2] !== null,
      );
      expect(styled).toEqual(spansByLine(text));
    },
    propTimeout(20),
  );
});
