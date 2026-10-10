/**
 * What the tooling entry point (`@rohal12/spindle/tooling`) bundles as
 * dist/pkg/story-variables.js: the StoryVariables parser and the markup
 * validator, with no Preact or DOM dependencies. pkg/tooling.js re-exports
 * them, binding the validator to its macro metadata.
 */
import {
  validateMarkup,
  type MarkupDiagnostic,
  type MarkupPassage,
} from './markup/validate';
import { isBlockMacro } from './markup/ast';
import { tokenizeMarkupTolerant } from './markup/parse';
import {
  parameterLookup,
  passagePiecesOf,
  pieceOffset,
  referencesOf,
  type PassageReference,
  type Piece,
} from './code-check';
import {
  blockWidgetNames,
  widgetDefinitions as readWidgetDefinitions,
  type WidgetDefinition,
} from './widgets/widget-def';
import {
  checkVariableReferences,
  collectVariableReferences,
  type VariableDeclarations,
  type VariableDiagnostic,
  type VariableReference,
} from './story-variables';
import type { ParameterDef } from './registry';

export { parseDeclarations, parseStoryVariables } from './story-variables';
export { discoverMacros } from './macro-discovery';
export type { DiscoveredMacro } from './macro-discovery';
export type {
  VariableDeclarations,
  VariableDiagnostic,
  VariableDiagnosticCode,
  VariableReference,
} from './story-variables';
export type {
  Declaration,
  DeclarationError,
  DeclarationErrorCode,
  FieldSchema,
  VarType,
  VariableSchema,
} from './story-variables';
export { checkParameterTypes } from './registry';
export { formatDiagnostic } from './markup/validate';
export { parseWidgetDef } from './widgets/widget-def';
export type { WidgetDef, WidgetDefinition } from './widgets/widget-def';

// The parsing rules (see "Tooling API" in docs/tooling.md): the leaf rules
// the runtime parses with, so editor tooling needn't mirror them.
export { findCodeEnd, lexJs, lexTemplate, scanStringLiteral } from './js-lexer';
export type {
  FindCodeEndOptions,
  JsGoal,
  JsLexHandlers,
  Sigil,
} from './js-lexer';
export {
  MarkupError,
  parseSelectors,
  tokenizeMarkup,
  tokenizeMarkupTolerant,
} from './markup/parse';
export type { ParseMarkupOptions, TolerantTokens } from './markup/parse';
export { SIGIL_SCOPES, isSigil } from './markup/tokens';
export type {
  AttributeSpan,
  ExpressionToken,
  HtmlToken,
  LinkToken,
  MacroToken,
  SelectorSpan,
  Selectors,
  TextToken,
  Token,
  VariableScope,
  VariableToken,
} from './markup/tokens';
export { pairMarkup } from './markup/pair';
export { pieceOffset };
export type {
  PairedBody,
  PairedBranch,
  PairedMarkup,
  PairedNode,
  PairingError,
  PairingErrorCode,
  PairMarkupOptions,
} from './markup/pair';
export { isBlockMacro } from './markup/ast';
export type { MarkupErrorCode } from './markup/parse';
export {
  endsWithOperator,
  readQuoted,
  splitArgs,
  splitTopLevel,
  stripLooseQuotes,
  unescapeQuoted,
} from './components/macros/arg-utils';
export { splitIncludeFlag } from './components/macros/include-args';
export {
  evaluatePassageName,
  passageTarget,
} from './components/macros/macro-args';
export type { PassageTarget } from './components/macros/macro-args';
export { transform } from './transform';
export type {
  ArgumentErrorPiece,
  CodePiece,
  PassagePiece,
  PassageReference,
  Piece,
  PieceBase,
  TextPiece,
} from './code-check';
export type {
  MarkupDiagnostic,
  MarkupDiagnosticCode,
  MarkupDiagnosticData,
  MarkupPassage,
} from './markup/validate';

/** What tooling knows about a macro (see MacroMetadata). */
/** Options for validating markup from tooling. */
export interface ValidateMarkupOptions {
  /**
   * Whether passage names written out (links, quoted `passage` arguments)
   * must name one of the passages given (default: true). Turn it off to
   * validate only part of a story.
   */
  checkPassageNames?: boolean;
  /**
   * Report every problem of a passage, not only the first malformed or
   * unpaired tag (default: false, which is the story-start check). The
   * macros, code, arguments and passage names are checked in the markup
   * that could be read around the malformed tags, so an unclosed `{if}` does
   * not hide the unknown macro, broken link and bad expression after it.
   */
  tolerant?: boolean;
}

export interface ToolingMacro {
  name: string;
  block: boolean;
  subMacros: string[];
  /**
   * Its declared parameters: their types tell which arguments are code, and
   * what a `string` or `text` argument holds (see ParameterDef.holds).
   */
  parameters?: readonly ParameterDef[];
  /** Whether it resolves markup: its strings hold markup by default. */
  interpolate?: boolean;
  /** Whether its first argument names the story variable it binds. */
  storeVar?: boolean;
}

/**
 * Validate the markup of a story's passages as Spindle does when the story
 * starts, against the given macros (built-in and user-defined): malformed
 * markup, unknown macros and syntax errors in code, with their passage, line
 * and column.
 */
export function validateStoryMarkup(
  passages: Iterable<MarkupPassage>,
  macros: Iterable<ToolingMacro>,
  options: ValidateMarkupOptions = {},
): MarkupDiagnostic[] {
  const list = [...passages];
  const all = [...macros];
  const known = new Set<string>();
  const parametersOf = parameterLookup(all);
  const blocks = new Set(
    blockWidgetNames(list, parametersOf).map((n) => n.toLowerCase()),
  );
  for (const macro of all) {
    const name = macro.name.toLowerCase();
    known.add(name);
    for (const sub of macro.subMacros) known.add(sub.toLowerCase());
    if (macro.block) blocks.add(name);
  }
  return validateMarkup(list, {
    isKnownMacro: (name) => known.has(name),
    macroNames: known,
    parametersOf,
    isBlockMacro: (name) =>
      blocks.has(name.toLowerCase()) || isBlockMacro(name),
    checkPassageNames: options.checkPassageNames,
    tolerant: options.tolerant,
  });
}

/** Whether a macro takes a body, among `macros` and the built-in ones. */
function blockLookup(macros: readonly ToolingMacro[]) {
  const blocks = new Set(
    macros.filter((m) => m.block).map((m) => m.name.toLowerCase()),
  );
  return (name: string) => blocks.has(name.toLowerCase()) || isBlockMacro(name);
}

/**
 * What a passage's markup runs and names, and where: the pieces of code
 * (`{$expr}` displays, `{do}` bodies, conditions, macro arguments by their
 * declared parameter types, strings that hold code), the passage names written
 * out (links, `passage` arguments), the texts that hold markup of their own
 * (labels, attribute values) and the arguments that don't have their
 * parameters' forms, in source order with offsets (UTF-16) into `source`. The
 * markup in a text follows it, as pieces marked `nested` with offsets into
 * `source` too. Malformed tags are skipped, so it reads half-typed markup.
 * The macros are those the markup may use, built-in and user-defined.
 */
export function passagePieces(
  source: string,
  macros: Iterable<ToolingMacro> = [],
): Piece[] {
  const all = [...macros];
  const { tokens } = tokenizeMarkupTolerant(source);
  return [
    ...passagePiecesOf(source, tokens, parameterLookup(all), {
      isBlock: blockLookup(all),
    }),
  ];
}

/**
 * The passages the markup of `source` names (see PassageReference), against
 * the given macros: what the story-start check looks up. Malformed tags are
 * skipped, so it reads half-typed markup. It is `passagePieces`, less what
 * names no passage.
 */
export function collectStoryPassageReferences(
  source: string,
  macros: Iterable<ToolingMacro>,
): PassageReference[] {
  return referencesOf(passagePieces(source, macros));
}

/**
 * The widgets the story defines, as the runtime reads them: those of
 * StoryInit and of the passages tagged `widget`, with their parameters,
 * whether their body renders `{@children}` (a block widget) and where they
 * are written, in source order. Half-typed definitions are reported without a
 * `closeStart`. The macros are those the markup may use, built-in and
 * user-defined (a `{@children}` in an attribute or label counts).
 */
export function widgetDefinitions(
  passages: Iterable<MarkupPassage>,
  macros: Iterable<ToolingMacro> = [],
): WidgetDefinition[] {
  return readWidgetDefinitions(passages, parameterLookup([...macros]));
}

/** Passages tagged so hold code or styles, not markup. */
const NOT_MARKUP_TAGS = ['script', 'stylesheet'];

/** What reading the variable references of markup depends on. */
function referenceOptions(macros: Iterable<ToolingMacro>, all = false) {
  const list = [...macros];
  return {
    all,
    storeVarMacros: new Set(
      list.filter((m) => m.storeVar).map((m) => m.name.toLowerCase()),
    ),
    parametersOf: parameterLookup(list),
    tolerant: true,
  };
}

/**
 * The `$` and `%` variable references that the markup of a passage evaluates,
 * in source order, with the dotted path of fields accessed and where each is
 * written (offsets into `source`, UTF-16): `{$var}` displays, code in
 * expressions, conditions, `{do}` bodies and macro arguments, quoted names
 * bound by input macros, and the markup in labels and HTML attributes. Prose
 * is literal text. Malformed tags are skipped, so it reads half-typed markup.
 * The macros are those the markup may use, built-in and user-defined.
 *
 * These are the references the story start checks. With `all: true`, the
 * list is complete (the checked ones are among it, in source order): it also
 * has the variable a macro names in a `variable` parameter, such as the
 * target of `{unset}` and `{computed}`, and the `{$name}` in the selectors of
 * a link, display or expression (`[[.c{$name} Go->T]]`). A rename or a find
 * of references needs these too.
 */
export function variableReferences(
  source: string,
  macros: Iterable<ToolingMacro> = [],
  options: { all?: boolean } = {},
): VariableReference[] {
  return collectVariableReferences(
    source,
    referenceOptions(macros, options.all),
  );
}

/**
 * The variable references of the passages' markup that are not valid against
 * the declarations, as the story start checks them: a variable (or, when
 * `transients` is given, a transient) that is not declared, and a field of a
 * primitive that it has no member of. Built on `variableReferences`:
 * tolerant of half-typed markup, and it evaluates no project code.
 */
export function validateVariableReferences(
  passages: Iterable<MarkupPassage>,
  declarations: VariableDeclarations,
  macros: Iterable<ToolingMacro> = [],
): VariableDiagnostic[] {
  return checkVariableReferences(
    [...passages].filter(
      (p) => !p.tags?.some((t) => NOT_MARKUP_TAGS.includes(t)),
    ),
    declarations,
    referenceOptions(macros),
  );
}
