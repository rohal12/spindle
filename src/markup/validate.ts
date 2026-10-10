/**
 * Markup validation: parse every passage when the story starts and report
 * malformed markup, unknown macros, syntax errors in the code it runs and
 * passage names that name no passage (see code-check.ts) with the passage,
 * line and column they are at, instead of failing when the passage renders.
 * Tooling runs it too (see src/tooling.ts).
 */
import {
  lineColumn,
  MarkupError,
  parseMarkup,
  tokenizeMarkup,
  type MarkupErrorCode,
} from './parse';
import type { Span, Token } from './tokens';
import { parseWidgetDef } from '../widgets/widget-def';
import {
  parseOrError,
  passagePiecesOf,
  pieceOffset,
  withParseCache,
  type CodePiece,
  type ParametersOf,
} from '../code-check';
import { CodeSyntaxError } from '../js-lexer';

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

/**
 * The kinds of diagnostic, which stay the same where the wording of the
 * message changes. The kinds of malformed markup are those of MarkupError.
 */
export type MarkupDiagnosticCode =
  | MarkupErrorCode
  | 'unknown-macro'
  | 'argument-error'
  | 'code-syntax'
  | 'unknown-passage'
  | 'unquoted-passage-name';

/** What a diagnostic names, by code (see docs/tooling.md). */
export type MarkupDiagnosticData = Readonly<
  Record<string, string | readonly string[]>
>;

/**
 * An error in a passage's markup, at the offending text from `start` up to
 * `end`: UTF-16 offsets into the passage's content, of which `line` and
 * `column` are those of `start`.
 */
export interface MarkupDiagnostic extends Span {
  passage: string;
  /** 1-based line within the passage's content. */
  line: number;
  /** 1-based column (UTF-16 code units). */
  column: number;
  message: string;
  /** The kind of error, which tools tell apart without reading `message`. */
  code: MarkupDiagnosticCode;
  /** What the diagnostic names, by `code`: the macro, the passage, what to try. */
  data?: MarkupDiagnosticData;
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
   * Whether passage names written out must name one of the passages
   * (default: true). Off when only part of a story is validated.
   */
  checkPassageNames?: boolean;
  /**
   * The declared parameters of a macro (see parameterLookup in
   * code-check.ts), whose `expression` and `statements` arguments are
   * checked as code and whose `text` and `string` arguments as what they
   * hold. Without them only the code of `{$…}`, `{do}`, branch conditions
   * and attributes is checked.
   */
  parametersOf?: ParametersOf;
}

/**
 * Passages that hold no markup: declarations, and the JavaScript function
 * body of SaveTitle.
 */
export const NOT_MARKUP = new Set([
  'StoryVariables',
  'StoryTransients',
  'SaveTitle',
]);
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

/** The known name closest to `name`, if one is close. */
function closestName(
  name: string,
  names: Iterable<string>,
): string | undefined {
  const lower = name.toLowerCase();
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(lower.length / 3)) + 1;
  for (const candidate of names) {
    const d = distance(lower, candidate.toLowerCase());
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }
  return best;
}

/** " Did you mean …?" with `best`, written by `quote`, if there is one. */
const didYouMean = (
  best: string | undefined,
  quote: (name: string) => string,
) => (best ? ` Did you mean ${quote(best)}?` : '');

/** What a passage argument may be, after an error in one. */
const PASSAGE_ARGUMENT_HINT =
  ' (a passage name is a quoted string or an expression)';

/** A passage argument that is one bare word (`{goto Kitchen}`). */
const BARE_WORD_RE = /^[A-Za-z][\w$]*$/;

/** The name of the widget a `{widget}` with these arguments defines. */
function widgetName(rawArgs: string): string | undefined {
  try {
    return parseWidgetDef(rawArgs).name.toLowerCase() || undefined;
  } catch {
    return undefined; // the {widget} macro reports it when it renders
  }
}

/**
 * Validate the markup of every passage. Passage names written out (links,
 * quoted `passage` arguments) must name one of `passages`.
 */
export function validateMarkup(
  passages: Iterable<MarkupPassage>,
  options: MarkupValidationOptions,
): MarkupDiagnostic[] {
  const diagnostics: MarkupDiagnostic[] = [];
  const hooks = options.isBlockMacro
    ? { isBlock: options.isBlockMacro }
    : undefined;
  const report = (
    passage: MarkupPassage,
    start: number,
    end: number,
    code: MarkupDiagnosticCode,
    message: string,
    data?: MarkupDiagnosticData,
  ) => {
    const { line, column } = lineColumn(passage.content, start);
    const d: MarkupDiagnostic = {
      passage: passage.name,
      line,
      column,
      message,
      code,
      start,
      end,
    };
    if (data) d.data = data;
    const file = passage.metadata?.['data-source-file'];
    if (file) {
      d.file = file;
      const header = Number(passage.metadata?.['data-source-line']);
      if (header) d.fileLine = header + line;
    }
    diagnostics.push(d);
  };
  /** Report malformed markup. */
  const reportError = (
    passage: MarkupPassage,
    err: MarkupError,
    where: string,
  ) =>
    report(
      passage,
      err.offset,
      err.end,
      err.code,
      where + err.reason,
      err.data,
    );

  // Parse every passage first: the widgets they define are known macros.
  const parsed: [MarkupPassage, Token[]][] = [];
  const widgets = new Set<string>();
  const passageNames = new Set<string>();
  for (const passage of passages) {
    passageNames.add(passage.name);
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
      if (reported) reportError(passage, err, '');
    }
  }
  const names = [...(options.macroNames ?? []), ...widgets];

  /** Report the unknown macros among `tokens`, with `where` in front. */
  const checkMacros = (
    passage: MarkupPassage,
    tokens: readonly Token[],
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
      const best = closestName(token.name, names);
      report(
        passage,
        token.start,
        token.end,
        'unknown-macro',
        `${where}Unknown macro {${token.name}}.${didYouMean(best, (n) => `{${n}}`)}`,
        { name: token.name, suggestions: best ? [best] : [] },
      );
    }
  };

  const parametersOf: ParametersOf = options.parametersOf ?? (() => undefined);

  /**
   * Check the pieces of a passage: its macros, the code in them, the passage
   * names they write out and the markup in their text.
   */
  const checkPassage = (passage: MarkupPassage, tokens: readonly Token[]) => {
    checkMacros(passage, tokens, '');
    // The markup of a text with an error in it is not read further
    let skipTo = 0;
    for (const piece of passagePiecesOf(passage.content, tokens, parametersOf, {
      isBlock: options.isBlockMacro,
    })) {
      if (piece.nested && piece.offset < skipTo) continue;
      const at = piece.offset;
      const where = piece.where && piece.nested ? piece.where : '';
      switch (piece.kind) {
        case 'argument-error':
          report(
            passage,
            at,
            at + piece.length,
            'argument-error',
            `${where}${piece.message} in ${piece.label}`,
            { macro: piece.macro },
          );
          break;
        case 'passage':
          if (
            options.checkPassageNames !== false &&
            !passageNames.has(piece.name)
          ) {
            const best = closestName(piece.name, passageNames);
            report(
              passage,
              at,
              at + piece.length,
              'unknown-passage',
              `${where}No passage named ${JSON.stringify(piece.name)} in ${piece.label}.${didYouMean(best, JSON.stringify)}`,
              {
                name: piece.name,
                macro: piece.macro,
                suggestions: best ? [best] : [],
              },
            );
          }
          break;
        case 'code':
          checkCode(passage, piece, where);
          break;
        case 'text':
          if (piece.errors.length > 0) {
            reportError(passage, piece.errors[0]!, piece.where);
            skipTo = pieceOffset(piece, piece.text.length);
          } else {
            checkMacros(passage, piece.tokens, piece.where);
          }
      }
    }
  };

  const checkCode = (
    passage: MarkupPassage,
    piece: CodePiece,
    where: string,
  ) => {
    const at = piece.offset;
    const result = parseOrError(piece.code, piece.goal);
    const code = piece.code.trim();
    if (result instanceof CodeSyntaxError) {
      const offending = /^(?:[\w$]+|\S)/.exec(piece.code.slice(result.pos));
      report(
        passage,
        pieceOffset(piece, result.pos),
        pieceOffset(piece, result.pos + (offending?.[0].length ?? 0)),
        'code-syntax',
        `${where}${result.reasonIn(passage.content, at)} in ${piece.label}` +
          (piece.passage ? PASSAGE_ARGUMENT_HINT : ''),
        piece.macro ? { macro: piece.macro } : undefined,
      );
    } else if (piece.passage && BARE_WORD_RE.test(code)) {
      const lead = piece.code.length - piece.code.trimStart().length;
      report(
        passage,
        pieceOffset(piece, lead),
        pieceOffset(piece, lead + code.length),
        'unquoted-passage-name',
        `${where}Unquoted passage name in ${piece.label}: write ${JSON.stringify(code)}${PASSAGE_ARGUMENT_HINT}`,
        { name: code, macro: piece.macro ?? '' },
      );
    }
  };

  for (const [passage, tokens] of parsed) {
    withParseCache(() => checkPassage(passage, tokens));
  }
  return diagnostics;
}
