import { sourcePositions } from '../markup/line-column';

/** Index a source once; locate zero-based lines without rescanning its prefixes. */
export function sourceLines(source: string): (offset: number) => number {
  const position = sourcePositions(source);
  return (offset) => position(offset).line - 1;
}
