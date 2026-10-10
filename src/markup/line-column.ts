/** 1-based line and column of `offset` in `text`. */
export function lineColumn(
  text: string,
  offset: number,
): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; ) {
    line++;
    lineStart = i + 1;
    i = text.indexOf('\n', lineStart);
  }
  return { line, column: offset - lineStart + 1 };
}
