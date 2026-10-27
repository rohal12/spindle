import { effectiveNamedDefinitions, NameMap } from './utils/macro-names';
export {
  completionContext,
  type CompletionContext,
  type CompletionContainer,
} from './completion-context';
import { branchParentLookup } from './registry';
import {
  consumesOptionClauses,
  isOptionClause,
} from './components/macros/option-clauses';
import { pairMarkup, type PairedNode } from './markup/pair';
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
import {
  isBlockMacro,
  isBuiltinBlockMacro,
  isRawMacro,
  isRegisteredBlockMacro,
} from './markup/ast';
import {
  tokenizeMarkup as tokenizeRawMarkup,
  tokenizeMarkupTolerant as tokenizeRawMarkupTolerant,
  type ParseMarkupOptions as RuntimeParseMarkupOptions,
  type TolerantTokens,
} from './markup/parse';
import {
  parameterLookup,
  passagePiecesOf,
  pieceOffset,
  referencesOf,
  type PassageReference,
  type Piece,
} from './code-check';
import {
  widgetDefinitions as readWidgetDefinitions,
  effectiveWidgetDefinitions,
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
import type { MacroToken, Token } from './markup/tokens';
import type { WidgetDef } from './widgets/widget-def';

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
export {
  effectiveWidgetDefinitions,
  parseWidgetDef,
} from './widgets/widget-def';
export type { WidgetDef, WidgetDefinition } from './widgets/widget-def';

// The parsing rules (see "Tooling API" in docs/tooling.md): the leaf rules
// the runtime parses with, so editor tooling needn't mirror them.
export {
  findCodeEnd,
  lexJs,
  lexTemplate,
  parseCode,
  scanStringLiteral,
} from './js-lexer';
export type {
  ParsedCode,
  VariableRef,
  FindCodeEndOptions,
  JsGoal,
  JsLexHandlers,
  Sigil,
} from './js-lexer';
export { MarkupError, parseSelectors } from './markup/parse';
export type { TolerantTokens } from './markup/parse';
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
export { formatPassage } from './format/format-passage';
export type {
  PassageFormatOptions,
  PrettierLike,
} from './format/format-passage';
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
export { isSpecialPassage } from './passage-roles';
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
  macroArgumentSpans,
  parseBoundVariable,
  evaluatePassageName,
  passageTarget,
} from './components/macros/macro-args';
export type {
  MacroArgumentSpan,
  BoundVariable,
  PassageTarget,
} from './components/macros/macro-args';
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
  /** Preserve builtin provenance; an explicit macro without it is a replacement. */
  source?: 'builtin' | 'user';
  block: boolean;
  subMacros: string[];
  /**
   * Its declared parameters: their types tell which arguments are code, and
   * what a `string` or `text` argument holds (see ParameterDef.holds).
   */
  parameters?: readonly ParameterDef[];
  /**
   * For a widget: its `@` parameters and what the ones that declare it hold
   * (`@target:passage`, see WidgetDef), so that a call is checked like the
   * call of a macro whose `string` parameter has that `holds`.
   */
  widget?: Pick<WidgetDef, 'params' | 'holds'>;
  /** Whether it resolves markup: its strings hold markup by default. */
  interpolate?: boolean;
  /** Whether its first argument names the story variable it binds. */
  storeVar?: boolean;
}

/** Public tokenization can use the same effective metadata as validation. */
export interface ParseMarkupOptions extends RuntimeParseMarkupOptions {
  /** Macro and widget metadata; widgets override builtin raw-body behavior. */
  macros?: Iterable<ToolingMacro>;
}

/** Widgets take precedence over macros regardless of metadata input order. */
function effectiveToolingMacros(
  macros: Iterable<ToolingMacro>,
): ToolingMacro[] {
  const list = [...macros];
  return effectiveNamedDefinitions([
    ...list.filter((m) => !m.widget),
    ...list.filter((m) => m.widget),
  ]);
}

function tokenizationOptions(
  options: ParseMarkupOptions,
): RuntimeParseMarkupOptions {
  if (!options.macros) return options;
  const macros = effectiveToolingMacros(options.macros);
  const parametersOf = parameterLookup(macros);
  return {
    ...options,
    hooks: {
      isRaw: (name) =>
        isRawMacro(name, parametersOf.widget?.(name) !== undefined),
      isBlock: blockLookup(macros),
      branchParents: branchParentLookup(macros),
      ...options.hooks,
    },
  };
}

/** Flat tokens with optional effective macro/widget metadata. */
export function tokenizeMarkup(
  source: string,
  options: ParseMarkupOptions = {},
): Token[] {
  return tokenizeRawMarkup(source, tokenizationOptions(options));
}

/** Metadata-aware flat tokens and recovery errors, in original source offsets. */
export function tokenizeMarkupTolerant(
  source: string,
  options: ParseMarkupOptions = {},
): TolerantTokens {
  return tokenizeRawMarkupTolerant(source, tokenizationOptions(options));
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
  const all = effectiveToolingMacros(macros);
  const known = new Set<string>();
  // The calls of widgets that declare what their arguments hold are checked
  const widgets = effectiveWidgetDefinitions(
    readWidgetDefinitions(list, parameterLookup(all)),
  );
  const effective = effectiveToolingMacros([
    ...all,
    ...widgets.map((widget) => ({
      name: widget.name,
      block: widget.block,
      subMacros: [],
      widget,
    })),
  ]);
  const parametersOf = parameterLookup([
    ...all,
    ...definedWidgetMacros(widgets),
  ]);
  for (const macro of all) {
    const name = macro.name.toLowerCase();
    known.add(name);
    for (const sub of macro.subMacros) known.add(sub.toLowerCase());
  }
  return validateMarkup(list, {
    branchParents: branchParentLookup(effective),
    isKnownMacro: (name) => known.has(name),
    macroNames: known,
    parametersOf,
    isBlockMacro: blockLookup(effective),
    checkPassageNames: options.checkPassageNames,
    tolerant: options.tolerant,
  });
}

/** The widgets as macros that declare what their parameters hold. */
function definedWidgetMacros(widgets: readonly WidgetDefinition[]) {
  return widgets.map((widget) => ({ name: widget.name, widget }));
}

/** Whether a macro takes a body, among `macros` and the built-in ones. */
function blockLookup(macros: readonly ToolingMacro[], includeRuntime = true) {
  const definitions = new NameMap<boolean>();
  for (const macro of effectiveToolingMacros(macros)) {
    definitions.set(macro.name, macro.block);
  }
  return (name: string) =>
    (includeRuntime && isRegisteredBlockMacro(name)) ||
    (definitions.get(name) ??
      (includeRuntime ? isBlockMacro(name) : isBuiltinBlockMacro(name)));
}

/** A macro head's contextual role, with original UTF-16 token spans. */
export interface MacroCall {
  token: MacroToken;
  kind: 'invocation' | 'branch' | 'value';
  /** The opening head consuming this clause; absent for invocations. */
  owner?: MacroToken;
}

/**
 * Classify heads against explicit effective metadata, without running code.
 * Labels and attributes are separate markup scopes and never inherit a
 * surrounding control's clause ownership. This describes dispatch, not
 * whether a conditional body will execute.
 */
export function macroCalls(
  source: string,
  macros: Iterable<ToolingMacro> = [],
): MacroCall[] {
  const all = effectiveToolingMacros(macros);
  const definitions = new NameMap(all.map((macro) => [macro.name, macro]));
  const parametersOf = parameterLookup(all);
  const options = tokenizationOptions({
    macros: all,
    hooks: { isBlock: blockLookup(all, false) },
  });
  const hooks = options.hooks!;
  const tokens = tokenizeRawMarkupTolerant(source, options).tokens;
  const calls: MacroCall[] = [];
  const classify = (tokens: readonly Token[]) => {
    const found = new Map<MacroToken, MacroCall>();
    const pending: { node: PairedNode; parent?: MacroToken }[] = pairMarkup(
      tokens,
      hooks,
    ).nodes.map((node) => ({ node }));
    while (pending.length) {
      const { node, parent } = pending.pop()!;
      const token = node.token;
      if (token.type === 'macro') {
        const definition = parent && definitions.get(parent.name);
        const value =
          definition &&
          consumesOptionClauses(definition) &&
          isOptionClause(token.name);
        found.set(token, {
          token,
          kind: value ? 'value' : 'invocation',
          ...(value && { owner: parent }),
        });
      }
      if (!node.body) continue;
      const owner = token.type === 'macro' ? token : undefined;
      for (const child of node.body.children)
        pending.push({ node: child, parent: owner });
      for (const branch of node.body.branches) {
        found.set(branch.tag, { token: branch.tag, kind: 'branch', owner });
        for (const child of branch.children)
          pending.push({ node: child, parent: owner });
      }
    }
    for (const token of tokens) {
      if (token.type !== 'macro' || token.isClose) continue;
      const call = found.get(token) ?? { token, kind: 'branch' as const };
      calls.push(call);
    }
  };
  classify(tokens);
  for (const piece of passagePiecesOf(source, tokens, parametersOf, {
    isBlock: hooks.isBlock,
  })) {
    if (piece.kind !== 'text' || !piece.tokens.length) continue;
    classify(piece.tokens);
  }
  // Consumed arguments are literal even if a same-named widget would
  // normally evaluate them as markup. Drop heads inside those arguments.
  let literalEnd = -1;
  return calls
    .sort((a, b) => a.token.start - b.token.start)
    .filter((call) => {
      if (call.token.start < literalEnd) return false;
      if (call.kind === 'value' || call.kind === 'branch')
        literalEnd = call.token.argsEnd;
      return true;
    });
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
  const all = effectiveToolingMacros(macros);
  const parametersOf = parameterLookup(all);
  return passagePiecesOfTokens(
    source,
    all,
    tokenizeMarkupTolerant(source, {
      hooks: {
        isRaw: (name) =>
          isRawMacro(name, parametersOf.widget?.(name) !== undefined),
      },
    }).tokens,
  );
}

/**
 * `passagePieces` for a caller that has the tokens of
 * `tokenizeMarkupTolerant(source)` already (the editor's highlighter). Not
 * part of the published tooling API.
 */
export function passagePiecesOfTokens(
  source: string,
  macros: Iterable<ToolingMacro>,
  tokens: readonly Token[],
): Piece[] {
  const all = effectiveToolingMacros(macros);
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

/**
 * What reading the variable references of markup depends on: the `macros`,
 * and the widgets of the `passages` that are given (the calls of those that
 * declare what their parameters hold are read by them).
 */
function referenceOptions(
  macros: Iterable<ToolingMacro>,
  all = false,
  passages: readonly MarkupPassage[] = [],
) {
  const list = [...macros];
  const effective = new NameMap<ToolingMacro>();
  for (const macro of list) effective.set(macro.name, macro);
  const widgets = effectiveWidgetDefinitions(
    readWidgetDefinitions(passages, parameterLookup(list)),
  );
  return {
    all,
    storeVarMacros: new Set(
      [...effective.values()]
        .filter((m) => m.storeVar)
        .map((m) => m.name.toLowerCase()),
    ),
    parametersOf: parameterLookup([...list, ...definedWidgetMacros(widgets)]),
    tolerant: true,
  };
}

/**
 * The `$` and `%` variable references that the markup of a passage evaluates,
 * in source order, with the dotted path of fields accessed and where each is
 * written (offsets into `source`, UTF-16): `{$var}` displays, code in
 * expressions, conditions, `{do}` bodies and macro arguments, quoted names
 * bound by input macros, and the markup in labels and HTML attributes. Input
 * bindings include decoded root/path names and editable `binding` spans. Prose
 * is literal text. Malformed tags are skipped, so it reads half-typed markup.
 * The macros are those the markup may use, built-in and user-defined.
 *
 * These are the references the story start checks. With `all: true`, the
 * list is complete (the checked ones are among it, in source order): it also
 * has sigilless input bindings (`{textbox "name"}`), the variable a macro
 * names in a `variable` parameter, such as the
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
  const list = [...passages];
  return checkVariableReferences(
    list.filter((p) => !p.tags?.some((t) => NOT_MARKUP_TAGS.includes(t))),
    declarations,
    referenceOptions(macros, false, list),
  );
}
