/** Shared bounds for reparsing markup inside labels, selectors and attributes. */
export class MarkupExpansionBudget {
  static readonly maxDepth = 64;
  private depth = 0;
  private remaining: number;

  constructor(sourceLength: number) {
    // Bound total rescanning as well as call depth, including large labels.
    this.remaining = Math.max(65_536, sourceLength * 8);
  }

  enter(length: number): boolean {
    if (this.depth >= MarkupExpansionBudget.maxDepth || length > this.remaining)
      return false;
    this.remaining -= length;
    this.depth++;
    return true;
  }

  leave(): void {
    this.depth--;
  }
}
