/**
 * Markup validation: parse every passage when the story starts and report
 * malformed markup, unknown macros and syntax errors in the code it runs
 * (see code-check.ts) with the passage, line and column they are at,
 * instead of failing when the passage renders. Tooling runs it too (see
 * src/tooling.ts).
 */
import { lineColumn, MarkupError, parseMarkup, tokenizeMarkup } from './parse';
import type { Token } from './tokens';
import { parseWidgetDef } from '../widgets/widget-def';
import { codeAndText, parseOrError, withParseCache } from '../code-check';
import { CodeSyntaxError } from '../js-lexer';
import type { ParameterDef } from '../registry';

/** A passage to validate. */
export interface MarkupPassage {
  name: string;
  content: string;
  tags?: string[];
  /**
   * Passage attributes; `data-source-file` and `data-source-line` (the
   * line of its `::` header) place errors in the source file.
   */
  metadata?: Record<string, string>;
}

/** An error in a passage's markup. */
export interface MarkupDiagnostic {
  passage: string;
  /** 1-based line within the passage's content. */
  line: number;
  /** 1-based column (UTF-16 code units). */
  column: number;
  message: string;
  /** The source file and line, when the passage says where it came from. */
  file?: string;
  fileLine?: number;
}

export interface MarkupValidationOptions {
  /**
   * Whether a macro of this name exists. Widgets that passages define with
   * `{widget}` and branch macros (`{else}`, `{case}`, …) always do.
   */
  isKnownMacro(name: string): boolean;
  /** Names to suggest for a misspelt macro. */
  macroNames?: Iterable<string>;
  /** Whether a macro takes a body (default: the registered block macros). */
  isBlockMacro?(name: string): boolean;
  /**
   * Report on only the passages for which this holds (default: all). The
   * others are still read for the widgets they define.
   */
  only?(passage: MarkupPassage): boolean;
  /**
   * The declared parameters of a macro, whose `expression` and `statements`
   * arguments are checked as code and whose `text` and `string` arguments
   * as markup (see code-check.ts). Without them only the code of `{$…}`,
   * `{do}`, branch conditions and attributes is checked.
   */
  parametersOf?(name: string): readonly ParameterDef[] | undefined;
}

/** Passages that hold no markup. */
const NOT_MARKUP = new Set(['StoryVariables', 'StoryTransients']);
const NOT_MARKUP_TAGS = ['script', 'stylesheet'];

/** Branch macros, which their parent macro renders. */
const BRANCH_MACROS = new Set(['elseif', 'else', 'case', 'default', 'next']);

/** A diagnostic as one line of text. */
export function formatDiagnostic(d: MarkupDiagnostic): string {
  const source = d.file
    ? ` (${d.file}${d.fileLine ? `:${d.fileLine}` : ''})`
    : '';
  return `Passage "${d.passage}", line ${d.line}, column ${d.column}${source}: ${d.message}`;
}

/** Edit distance, for "did you mean" suggestions. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/** " Did you mean {name}?" for the closest known name, if one is close. */
function suggestion(name: string, names: readonly string[]): string {
  const lower = name.toLowerCase();
  let best = '';
  let bestDistance = Math.max(2, Math.floor(lower.length / 3)) + 1;
  for (const candidate of names) {
    const d = distance(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best ? ` Did you mean {${best}}?` : '';
}

/** The name of the widget a `{widget}` with these arguments defines. */
function widgetName(rawArgs: string): string | undefined {
  try {
    return parseWidgetDef(rawArgs).name.toLowerCase() || undefined;
  } catch {
    return undefined; // the {widget} macro reports it when it renders
  }
}

/** Validate the markup of every passage. */
export function validateMarkup(
  passages: Iterable<MarkupPassage>,
  options: MarkupValidationOptions,
): MarkupDiagnostic[] {
  const diagnostics: MarkupDiagnostic[] = [];
  const hooks = options.isBlockMacro
    ? { isBlock: options.isBlockMacro }
    : undefined;
  const report = (passage: MarkupPassage, offset: number, message: string) => {
    const { line, column } = lineColumn(passage.content, offset);
    const d: MarkupDiagnostic = {
      passage: passage.name,
      line,
      column,
      message,
    };
    const file = passage.metadata?.['data-source-file'];
    if (file) {
      d.file = file;
      const header = Number(passage.metadata?.['data-source-line']);
      if (header) d.fileLine = header + line;
    }
    diagnostics.push(d);
  };

  // Parse every passage first: the widgets they define are known macros.
  const parsed: [MarkupPassage, Token[]][] = [];
  const widgets = new Set<string>();
  for (const passage of passages) {
    if (NOT_MARKUP.has(passage.name)) continue;
    if (passage.tags?.some((tag) => NOT_MARKUP_TAGS.includes(tag))) continue;
    const reported = !options.only || options.only(passage);
    try {
      // The tokens first: they don't depend on which macros take a body
      const tokens = tokenizeMarkup(passage.content);
      for (const token of tokens) {
        if (token.type !== 'macro' || token.isClose) continue;
        if (token.name.toLowerCase() !== 'widget') continue;
        const name = widgetName(token.rawArgs);
        if (name) widgets.add(name);
      }
      if (!reported) continue;
      parseMarkup(passage.content, { hooks });
      parsed.push([passage, tokens]);
    } catch (err) {
      if (!(err instanceof MarkupError)) throw err;
      if (reported) {
        report(passage, err.offset, err.reason);
      }
    }
  }
  const names = [...(options.macroNames ?? []), ...widgets];

  /** Report the unknown macros among `tokens`, which start at `base`. */
  const checkMacros = (
    passage: MarkupPassage,
    tokens: Token[],
    base: number,
    where: string,
  ) => {
    for (const token of tokens) {
      if (token.type !== 'macro' || token.isClose) continue;
      const lower = token.name.toLowerCase();
      if (
        BRANCH_MACROS.has(lower) ||
        widgets.has(lower) ||
        options.isKnownMacro(lower)
      ) {
        continue;
      }
      report(
        passage,
        base + token.start,
        `${where}Unknown macro {${token.name}}.${suggestion(token.name, names)}`,
      );
    }
  };

  const parametersOf = options.parametersOf ?? (() => undefined);

  /**
   * Check `tokens`, the tokens of `src`, which starts at `base` in the
   * passage: their macros, the code in them and the markup in their text.
   */
  const checkTokens = (
    passage: MarkupPassage,
    src: string,
    tokens: Token[],
    base: number,
    where: string,
  ) => {
    checkMacros(passage, tokens, base, where);
    for (const piece of codeAndText(src, tokens, parametersOf)) {
      const at = base + piece.offset;
      if (piece.kind === 'code') {
        const result = parseOrError(piece.code, piece.goal);
        if (result instanceof CodeSyntaxError) {
          report(
            passage,
            at + result.pos,
            `${where}${result.reasonIn(passage.content, at)} in ${piece.label}`,
          );
        }
        continue;
      }
      if (!piece.text.includes('{')) continue;
      try {
        parseMarkup(piece.text, { text: true, hooks });
        const inner = tokenizeMarkup(piece.text, { text: true });
        checkTokens(passage, piece.text, inner, at, piece.where);
      } catch (err) {
        if (!(err instanceof MarkupError)) throw err;
        report(passage, at + err.offset, piece.where + err.reason);
      }
    }
  };

  for (const [passage, tokens] of parsed) {
    withParseCache(() => checkTokens(passage, passage.content, tokens, 0, ''));
  }
  return diagnostics;
}
