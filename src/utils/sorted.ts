/** Index of the first sorted value greater than `value` (or the length). */
export function upperBound(sorted: readonly number[], value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid]! <= value) low = mid + 1;
    else high = mid;
  }
  return low;
}
