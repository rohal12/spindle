// Types of the parser spindle.peggy compiles to (see scripts/peggy.ts).

/** A position in the input; only `offset` is used by parse.ts. */
export interface Location {
  offset: number;
  line: number;
  column: number;
}

/** What the generated parser throws for malformed markup. */
export declare class SyntaxError extends globalThis.SyntaxError {
  location: { start: Location; end: Location };
}

export interface ParseOptions {
  startRule: 'Markup' | 'Tokens';
  /** Text mode (attribute values, labels). */
  text: boolean;
  /** What the grammar leaves to code (see parse.ts MarkupHooks). */
  hooks: unknown;
}

/** Parse markup: the AST for `Markup`, the tokens for `Tokens`. */
export declare function parse(input: string, options: ParseOptions): unknown;
