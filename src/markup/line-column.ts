import { upperBound } from '../utils/sorted';

/** 1-based line and column of `offset` in `text`. */
export function lineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset;) {
    line++;
    lineStart = i + 1;
    i = text.indexOf('\n', lineStart);
  }
  return { line, column: offset - lineStart + 1 };
}

/** Index one source once; offsets and columns count UTF-16 code units. */
export function sourcePositions(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') starts.push(i + 1);
  }
  return (offset: number) => {
    const line = Math.max(1, upperBound(starts, offset));
    return { line, column: offset - starts[line - 1]! + 1 };
  };
}
