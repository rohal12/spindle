/** Index a source once; locate zero-based lines without rescanning its prefixes. */
export function sourceLines(source: string): (offset: number) => number {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\n') starts.push(i + 1);
  }
  return (offset) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle]! <= offset) low = middle + 1;
      else high = middle;
    }
    return Math.max(0, low - 1);
  };
}
