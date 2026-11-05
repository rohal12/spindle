// @vitest-environment happy-dom
import { createRequire } from 'node:module';
import type { StringStream } from 'codemirror';
import { expect, it } from 'vitest';
import { mode } from '../../src/twine-editor/mode';
import { expectAboutLinear, LINEAR_TIMEOUT } from '../support/linear-time';

const require = createRequire(import.meta.url);
const CodeMirror = require('codemirror/addon/runmode/runmode.node.js') as {
  StringStream: new (text: string) => StringStream;
};

function streamFor(text: string): StringStream {
  const stream = new CodeMirror.StringStream(text);
  stream.lookAhead = () => undefined;
  return stream;
}

it('copies partially consumed line state independently, including gaps (#728)', () => {
  const current = mode();
  const state = current.startState!();
  const text = '{print 1} plain {print 2}';
  const stream = streamFor(text);
  expect(current.token(stream, state)).toBe('keyword');
  const copied = current.copyState!(state);
  const other = streamFor(text);
  other.pos = stream.pos;
  const consume = (s: StringStream, st: typeof state) => {
    const tokens = [];
    while (!s.eol()) {
      s.start = s.pos;
      const style = current.token(s, st);
      tokens.push([s.current(), style]);
    }
    return tokens;
  };
  const expected = consume(stream, state);
  expect(consume(other, copied)).toEqual(expected);
  expect(expected).toContainEqual([' plain ', null]);
  // Each subsequent line starts its own span cursor.
  expect(current.token(streamFor('{print 3}'), copied)).toBe('keyword');
});

it(
  'emits already highlighted spans in linear time (#728)',
  { timeout: LINEAR_TIMEOUT },
  () => {
    const prepare = (count: number) => {
      const current = mode();
      const initial = current.startState!();
      const stream = streamFor('{print 1} '.repeat(count));
      current.token(stream, initial);
      const pos = stream.pos;
      return () => {
        // Highlighting is outside the measurement: this covers token emission.
        const state = current.copyState!(initial);
        stream.pos = pos;
        while (!stream.eol()) {
          stream.start = stream.pos;
          current.token(stream, state);
        }
      };
    };
    expectAboutLinear(prepare(8000), prepare(64000), { rounds: 3 });
  },
);
