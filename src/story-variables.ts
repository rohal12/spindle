import type { Passage } from './parser';
import type { Spans, Token } from './markup/tokens';
import {
  MarkupError,
  tokenizeMarkup,
  tokenizeMarkupTolerant,
} from './markup/parse';
import { isCodeAttribute } from './markup/code-attributes';
import { isRawMacro } from './markup/ast';
import { errorMessage } from './utils/error-message';
import {
  CodeSyntaxError,
  lexJs,
  readMemberPath,
  scanStringLiteral,
  type JsGoal,
  type VariableRef,
} from './js-lexer';
import {
  argPieces,
  attributeValues,
  sigilExpressions,
  parseOrError,
  pieceOffset,
  widgetPieces,
  withParseCache,
  executesRawBody,
  type ParametersOf,
  type Piece,
} from './code-check';
import { getMacroParameters, type ParameterDef } from './registry';
import {
  MacroArgumentError,
  parseBoundVariable,
  parseMacroArgs,
  type ArgSpans,
  type BoundVariable,
} from './components/macros/macro-args';
import { NOT_MARKUP } from './markup/validate';
import {
  createNamespace,
  isArrayIndex,
  variableNameError,
} from './utils/namespace';
import { staticLiteral, type LiteralShape } from './static-literal';
import { parse } from 'acorn';
import { MarkupExpansionBudget } from './markup/expansion-budget';

/**
 * The tokens of markup, or none if it is malformed (validateMarkup reports
 * that, with its position); in tolerant mode, those of the well-formed parts.
 */
function tokensOf(
  text: string,
  textMode: boolean,
  {
    tolerant,
    parametersOf,
  }: { tolerant?: boolean; parametersOf?: ParametersOf } = {},
): Token[] {
  const options = {
    text: textMode,
    hooks: parametersOf && {
      isRaw: (name: string) =>
        isRawMacro(name, parametersOf.widget?.(name) !== undefined),
    },
  };
  if (tolerant) return tokenizeMarkupTolerant(text, options).tokens;
  try {
    return tokenizeMarkup(text, options);
  } catch (err) {
    if (err instanceof MarkupError) return [];
    throw err;
  }
}

export type VarType =
  'number' | 'string' | 'boolean' | 'array' | 'object' | 'null';

export interface FieldSchema {
  type: VarType;
  fields?: Map<string, FieldSchema>; // only for objects
}

export interface VariableSchema extends FieldSchema {
  name: string;
  default: unknown;
}

function declarationRegex(sigil: string): RegExp {
  const escaped = sigil.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(\\w+)\\s*=\\s*(.+)$`);
}
const VALID_VAR_TYPES = new Set<string>(['number', 'string', 'boolean']);

/** Boxed sample values whose members a primitive of each type can access. */
const PRIMITIVE_SAMPLES: Partial<Record<VarType, object>> = {
  string: Object(''),
  number: Object(0),
  boolean: Object(false),
};

/**
 * The schema of a default value. An object met again (a backreference, a
 * shared subtree) has the schema made for it the first time, so a cyclic
 * default gives a schema that refers to itself instead of recursing forever.
 */
function inferSchema(
  value: unknown,
  seen = new Map<object, FieldSchema>(),
): FieldSchema {
  if (Array.isArray(value)) {
    return { type: 'array' };
  }
  // A default of null means "nothing yet"; the value may later be anything
  if (value === null) return { type: 'null' };
  if (typeof value === 'object') {
    const known = seen.get(value);
    if (known) return known;
    const fields = new Map<string, FieldSchema>();
    const schema: FieldSchema = { type: 'object', fields };
    seen.set(value, schema);
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      fields.set(key, inferSchema(val, seen));
    }
    return schema;
  }
  const jsType = typeof value;
  if (!VALID_VAR_TYPES.has(jsType)) {
    throw new Error(
      `Unsupported type "${jsType}" for value ${String(value)}. Expected number, string, boolean, array, or object.`,
    );
  }
  return { type: jsType as VarType };
}

/** What is wrong with a declaration (see DeclarationError). */
export type DeclarationErrorCode =
  | 'invalid-declaration'
  | 'invalid-name'
  | 'duplicate-declaration'
  | 'unsupported-value'
  | 'syntax';

/**
 * A declaration of a StoryVariables or StoryTransients passage: the name
 * (without the sigil) and the initializer expression (without surrounding
 * space) are written from `nameStart` to `nameEnd` and from `valueStart` to
 * `valueEnd` (UTF-16 offsets).
 */
export interface Declaration extends Spans<'name'>, Spans<'value'> {
  name: string;
  /**
   * The shape of the initializer when it is static: a literal, or an array or
   * object literal of them (an object has the members that are static).
   * Absent when it is not.
   */
  schema?: FieldSchema;
}

/**
 * An invalid line of a StoryVariables or StoryTransients passage, from
 * `offset` up to `end` (UTF-16 offsets into the content).
 */
export interface DeclarationError extends Record<'offset' | 'end', number> {
  code: DeclarationErrorCode;
  /** What is wrong, as parseStoryVariables throws it after the passage name. */
  message: string;
}

const UNSUPPORTED_TYPE = 'Expected number, string, boolean, array, or object.';

/** The schema of a literal shape (see staticLiteral). */
function shapeSchema(shape: LiteralShape): FieldSchema {
  if (!shape.fields) return { type: shape.type };
  const fields = new Map<string, FieldSchema>();
  for (const [key, member] of shape.fields)
    fields.set(key, shapeSchema(member));
  return { type: shape.type, fields };
}

/**
 * What is wrong with the syntax of an initializer, as it is evaluated
 * (`return (expr)` in a function body), or `undefined`. `pos` is where, as an
 * index into `expr` (it may be past its end, for an unexpected end).
 */
function initializerSyntaxError(
  expr: string,
): { message: string; pos: number } | undefined {
  const prefix = 'return (';
  try {
    parse(prefix + expr + '\n)', {
      ecmaVersion: 'latest',
      allowReturnOutsideFunction: true,
    });
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    const { pos } = err as SyntaxError & { pos: number };
    return {
      message: err.message.replace(/ \(\d+:\d+\)$/, ''),
      pos: Math.max(0, pos - prefix.length),
    };
  }
  return undefined;
}

/**
 * Read the declarations of a StoryVariables (`$name = value`) or
 * StoryTransients (`%name = value`) passage, without evaluating them and
 * without throwing: every valid declaration, and every invalid line as an
 * error. It is the grammar parseStoryVariables reads with.
 *
 * A declaration is a line of the form `$name = expression`; blank lines are
 * skipped. A line that is not, and a name that cannot be a variable, are
 * errors. So is an initializer with a syntax error, and one that no variable
 * can hold (a function, `undefined`) when it is a literal, or one that throws
 * when it is a literal (`+1n`); whether any other initializer can only be
 * known by running it. A name declared again is an error too, but both
 * declarations are returned (the later wins when evaluated).
 */
export function parseDeclarations(
  content: string,
  sigil: '$' | '%' = '$',
): { declarations: Declaration[]; errors: DeclarationError[] } {
  const declarations: Declaration[] = [];
  const errors: DeclarationError[] = [];
  const DECLARATION_RE = declarationRegex(sigil);
  const seen = new Set<string>();

  let lineStart = 0;
  for (const rawLine of content.split('\n')) {
    const at = lineStart + rawLine.length - rawLine.trimStart().length;
    lineStart += rawLine.length + 1;
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(DECLARATION_RE);
    const error = (
      code: DeclarationErrorCode,
      start: number,
      end: number,
      message: string,
    ) => errors.push({ code, offset: start, end, message });
    if (!match) {
      error(
        'invalid-declaration',
        at,
        at + line.length,
        `Invalid declaration: "${line}". Expected: ${sigil}name = value`,
      );
      continue;
    }

    const [, name, expr] = match as [string, string, string];
    const nameStart = at + sigil.length;
    const nameEnd = nameStart + name.length;
    const nameError = variableNameError(name, sigil + name);
    if (nameError) {
      error('invalid-name', nameStart, nameEnd, nameError);
      continue;
    }
    const valueEnd = at + line.length;
    const declaration: Declaration = {
      name,
      nameStart,
      nameEnd,
      valueStart: valueEnd - expr.length,
      valueEnd,
    };
    if (seen.has(name)) {
      error(
        'duplicate-declaration',
        nameStart,
        nameEnd,
        `Duplicate declaration of ${sigil}${name}`,
      );
    }
    seen.add(name);
    declarations.push(declaration);
    const failed = `Failed to evaluate "${sigil}${name} = ${expr}"`;
    const syntax = initializerSyntaxError(expr);
    if (syntax) {
      // At the problem; at the last character for an unexpected end
      const at = Math.min(syntax.pos, expr.length - 1);
      error(
        'syntax',
        declaration.valueStart + at,
        declaration.valueStart + at + 1,
        `${failed}: ${syntax.message}`,
      );
      continue;
    }
    const literal = staticLiteral(expr);
    if (!literal) continue;
    if ('shape' in literal) {
      declaration.schema = shapeSchema(literal.shape);
    } else if ('throws' in literal) {
      error(
        'unsupported-value',
        declaration.valueStart,
        valueEnd,
        `${failed}: ${literal.throws}`,
      );
    } else {
      error(
        'unsupported-value',
        declaration.valueStart,
        valueEnd,
        `Unsupported type "${literal.unsupported}" for value ${literal.value}. ${UNSUPPORTED_TYPE}`,
      );
    }
  }
  return { declarations, errors };
}

/**
 * Parse a StoryVariables or StoryTransients passage content into a schema map.
 * Each line: `$varName = expression` (or `%varName = expression` for transients)
 * The expressions are evaluated; parseDeclarations reads the same lines
 * without.
 */
export function parseStoryVariables(
  content: string,
  sigil: '$' | '%' = '$',
): Map<string, VariableSchema> {
  const schema = new Map<string, VariableSchema>();
  const passageName = sigil === '%' ? 'StoryTransients' : 'StoryVariables';
  const { declarations, errors } = parseDeclarations(content, sigil);

  // Lines in order: the first that is invalid, or that cannot be evaluated,
  // is the error. What parseDeclarations reports about a value that is
  // evaluated here is left to the evaluation (its wording is the runtime's).
  const lines = [
    ...errors
      .filter(
        (e) => e.code === 'invalid-declaration' || e.code === 'invalid-name',
      )
      .map((e) => ({ at: e.offset, error: e })),
    ...declarations.map((d) => ({ at: d.nameStart, declaration: d })),
  ].sort((a, b) => a.at - b.at);

  for (const line of lines) {
    if ('error' in line) {
      throw new Error(`${passageName}: ${line.error.message}`);
    }
    const { name, valueStart, valueEnd } = line.declaration;
    const expr = content.slice(valueStart, valueEnd);
    let value: unknown;
    try {
      value = new Function('return (' + expr + '\n)')();
    } catch (err) {
      throw new Error(
        `${passageName}: Failed to evaluate "${sigil}${name} = ${expr}": ${errorMessage(err)}`,
      );
    }

    let fieldSchema: FieldSchema;
    try {
      fieldSchema = inferSchema(value);
    } catch (err) {
      throw new Error(`${passageName}: ${errorMessage(err)}`);
    }
    schema.set(name, { ...fieldSchema, name, default: value });
  }

  return schema;
}

/** A reference to a story (`$`) or transient (`%`) variable in markup. */
export interface VariableReference {
  sigil: '$' | '%';
  /** The variable, without the sigil. */
  name: string;
  /** The fields accessed with dots (`$a.b.c`: `['b', 'c']`). */
  path: string[];
  /** Where `$a.b.c` is written in the markup, as `[start, end)` UTF-16 offsets. */
  start: number;
  end: number;
  /**
   * For an input binding, its decoded identity and editable root span.
   * Offsets are into the markup, including inside escaped labels. The sigil
   * is semantically `$` even when `binding.explicitSigil` is false.
   */
  binding?: BoundVariable;
}

/** What a check of a variable reference found wrong with it. */
export type VariableDiagnosticCode =
  | 'undeclared-variable'
  | 'undeclared-transient'
  | 'reserved-name'
  | 'primitive-field';

/** A variable reference that is not valid against the declarations. */
export interface VariableDiagnostic {
  passage: string;
  code: VariableDiagnosticCode;
  /** The variable, without the sigil. */
  name: string;
  /** The fields accessed with dots. */
  path?: string[];
  /** The reference, as offsets into the passage content. */
  start: number;
  end: number;
  message: string;
}

/**
 * What is declared: the schema of each variable, which is absent for one
 * whose initializer is not static (`parseDeclarations`): it is declared, but
 * its fields are not checked.
 */
export interface VariableDeclarations {
  variables: ReadonlyMap<string, FieldSchema | undefined>;
  /**
   * The transients (`%`). They are not checked when absent, as the story
   * start does not check them.
   */
  transients?: ReadonlyMap<string, FieldSchema | undefined>;
}

/**
 * Check a reference against the declarations: the error code and message, or
 * null if it is valid. (Unknown fields of objects are valid: classes
 * registered with Story.registerClass() can add members that are not in the
 * defaults.)
 */
function checkReference(
  ref: VariableReference,
  declared: VariableDeclarations,
): { code: VariableDiagnosticCode; message: string } | null {
  const label = (path: readonly string[]) =>
    ref.sigil + [ref.name, ...path].join('.');
  const nameError = variableNameError(ref.name, ref.sigil + ref.name);
  if (nameError) return { code: 'reserved-name', message: nameError };

  const schema = ref.sigil === '$' ? declared.variables : declared.transients;
  if (!schema) return null;
  if (!schema.has(ref.name)) {
    return ref.sigil === '$'
      ? {
          code: 'undeclared-variable',
          message: `Undeclared variable: ${label(ref.path)}`,
        }
      : {
          code: 'undeclared-transient',
          message: `Undeclared transient: ${label(ref.path)}`,
        };
  }

  // Walk through the field access path
  let current = schema.get(ref.name);
  for (let i = 0; current && i < ref.path.length; i++) {
    const part = ref.path[i]!;

    // Arrays have built-in methods/properties (push, find, length, etc.)
    // so any field access on an array is allowed.
    if (current.type === 'array') return null;
    // A null default may later hold a value of any shape
    if (current.type === 'null') return null;

    // Primitives expose their wrapper's built-ins (length, toUpperCase,
    // toFixed, etc.). Keep validating past properties of primitive type.
    // Strings also have the character at each index below their length,
    // which the empty sample has none of (the default may not be the value)
    if (current.type === 'string' && isArrayIndex(part)) {
      continue;
    }
    const sample = PRIMITIVE_SAMPLES[current.type];
    if (sample && part in sample) {
      const member: unknown = sample[part as keyof typeof sample];
      const memberType = typeof member;
      if (!VALID_VAR_TYPES.has(memberType)) return null;
      current = { type: memberType as VarType };
      continue;
    }

    if (current.type !== 'object' || !current.fields) {
      return {
        code: 'primitive-field',
        message: `Cannot access field "${part}" on ${label(ref.path.slice(0, i))} (type: ${current.type})`,
      };
    }
    current = current.fields.get(part);
  }

  return null;
}

/**
 * Built-in input macros whose first argument names the bound story variable,
 * quoted or not (e.g. `{textbox "$name"}`).
 */
const BUILTIN_STORE_VAR_MACROS: readonly string[] = [
  'checkbox',
  'cycle',
  'listbox',
  'numberbox',
  'radiobutton',
  'textarea',
  'textbox',
];

/** What reading the variable references of markup depends on. */
interface ReferenceOptions {
  expansionBudget?: MarkupExpansionBudget;
  /** The (lowercase) names of the input macros that bind a variable. */
  storeVarMacros: ReadonlySet<string>;
  parametersOf: ParametersOf;
  /** Read half-typed markup: skip its malformed tags (default: none read). */
  tolerant?: boolean;
  /**
   * Also report the references the story start does not check: the variable
   * a macro writes to, such as the target of `{unset}` and `{computed}`
   * (a `variable` parameter), and those in the selectors of a link,
   * `{$var}` display or expression.
   */
  all?: boolean;
}

/** Where index `i` of a text is in the markup being read. */
type At = (i: number) => number;

type Emit = (ref: VariableReference) => void;

const NO_STORE_VAR_MACROS: ReadonlySet<string> = new Set();

/**
 * The reference to variable `name`, which JavaScript reads at `[start, end)`
 * of `code` (the sigil and the name as written, which may be spelled with
 * escapes), with the dot path written after it.
 */
function referenceAt(
  code: string,
  {
    sigil,
    name,
    start,
    end,
  }: Pick<VariableRef, 'sigil' | 'name' | 'start' | 'end'>,
  at: At,
): VariableReference {
  const fields = readMemberPath(code, end);
  return {
    sigil: sigil as '$' | '%',
    name,
    path: fields.path,
    start: at(start),
    end: at(fields.end),
  };
}

/**
 * Scan the value of a code attribute (`onclick`, see isCodeAttribute) for
 * the `{$…}` references resolved in it; its other braces are code. `at` is
 * where the value is.
 */
function scanSigilReferences(value: string, at: At, emit: Emit): void {
  for (const { expr, at: k } of sigilExpressions(value)) {
    scanCode(expr, (i) => at(k + i), emit);
  }
}

/**
 * Scan literal text (string contents, HTML attribute values) for the markup
 * that labels and HTML attributes evaluate at runtime: `{$…}` displays,
 * expressions and macros, read as in passage text. A bare `$word` in
 * literal text is not a reference.
 */
function scanInterpolations(
  text: string,
  at: At,
  emit: Emit,
  options: ReferenceOptions,
): void {
  if (!text.includes('{')) return;
  const budget = options.expansionBudget!;
  if (!budget.enter(text.length)) return;
  try {
    const offset = at(0);
    const sourceOffsets =
      at(text.length) - offset === text.length
        ? undefined
        : Array.from({ length: text.length + 1 }, (_, i) => at(i));
    collectTokenRefs(
      text,
      tokensOf(text, true, options),
      (i) => sourceOffsets?.[i] ?? offset + i,
      emit,
      options,
    );
  } finally {
    budget.leave();
  }
}

/**
 * Report `$var` references in JavaScript code, lexed as the expression
 * engine lexes it (`lexJs`): references in code, but none inside string or
 * regex literals or comments, nor property names (`a.$b`, `{ $b: 1 }`).
 * The text of string and template literals is not scanned: a string in code
 * is literal text unless a macro argument that holds markup is read as such
 * (see scanArgs); the `${…}` parts of template literals are code.
 */
function scanCode(
  code: string,
  at: At,
  emit: Emit,
  goal: JsGoal = 'expression',
): void {
  const parsed = parseOrError(code, goal);
  if (parsed instanceof CodeSyntaxError) {
    scanCodeLeniently(code, at, emit, goal);
    return;
  }
  for (const ref of parsed.refs) {
    if (ref.sigil !== '$' && ref.sigil !== '%') continue;
    emit(referenceAt(code, ref, at));
  }
}

/** `scanCode` for code acorn can't parse: lexed leniently. */
function scanCodeLeniently(
  code: string,
  at: At,
  emit: Emit,
  goal: JsGoal,
): void {
  lexJs(
    code,
    {
      variable(sigil, name, index, _nesting, end) {
        if (sigil !== '$' && sigil !== '%') return;
        emit(referenceAt(code, { sigil, name, start: index, end }, at));
      },
      // Strings, regex literals and comments hold no references
      literal() {},
    },
    goal,
  );
}

/** Report the references in the pieces of code and markup text of arguments. */
function scanPieces(
  pieces: Iterable<Piece>,
  at: At,
  emit: Emit,
  options: ReferenceOptions,
): void {
  for (const piece of pieces) {
    const pieceAt: At = (i) => at(pieceOffset(piece, i));
    if (piece.kind === 'code') {
      scanCode(piece.code, pieceAt, emit, piece.goal);
    } else if (piece.kind === 'text') {
      scanInterpolations(piece.text, pieceAt, emit, {
        ...options,
        storeVarMacros: NO_STORE_VAR_MACROS,
      });
    }
  }
}

/**
 * Report the references in the arguments of a macro by what its parameters
 * say each holds (see ParameterDef.holds): code is scanned as code and
 * markup as markup, but literal text (a placeholder, a passage name) holds
 * none. A macro without declared parameters, or arguments that do not
 * parse, are scanned as code. The arguments of a widget that declares what
 * some parameters hold are also read by those (see widgetPieces).
 */
function scanArgs(
  token: Extract<Token, { type: 'macro' }>,
  parametersOf: ParametersOf,
  at: At,
  emit: Emit,
  options: ReferenceOptions,
): void {
  if (!token.rawArgs) return;
  const params = parametersOf(token.name);
  let byParameters = false;
  if (params) {
    if (!options.storeVarMacros.has(token.name.toLowerCase())) {
      scanVariableParameters(token, params, at, emit, options.all);
    }
    const pieces = [
      ...argPieces(token.rawArgs, token.argsStart, params, token.name, ''),
    ];
    byParameters = !pieces.some((piece) => piece.kind === 'argument-error');
    if (byParameters) scanPieces(pieces, at, emit, options);
  }
  // The arguments of a widget are code: the strings among them hold none,
  // but those that declare they hold code or markup are scanned as that
  if (!byParameters) {
    scanCode(token.rawArgs, (i) => at(token.argsStart + i), emit);
  }
  const widget = parametersOf.widget?.(token.name);
  if (widget) {
    scanPieces(
      widgetPieces(token.rawArgs, token.argsStart, widget, token.name, ''),
      at,
      emit,
      options,
    );
  }
}

/**
 * Report the variables the `variable` parameters of a macro name
 * (`{unset $x}`, `{computed $x = …}`). Computed members read variables even
 * when the receiver itself is only included in the complete editor list.
 */
function scanVariableParameters(
  token: Extract<Token, { type: 'macro' }>,
  params: readonly ParameterDef[],
  at: At,
  emit: Emit,
  all: boolean | undefined,
): void {
  const spans: ArgSpans = new Map();
  try {
    parseMacroArgs(token.rawArgs, params, spans);
  } catch (err) {
    if (err instanceof MacroArgumentError) return;
    throw err;
  }
  for (const param of params) {
    const span = spans.get(param);
    if (param.type !== 'variable' || !span) continue;
    const start = token.argsStart + span[0];
    scanCode(
      token.rawArgs.slice(span[0], span[1]),
      (i) => at(start + i),
      (ref) => {
        if (all || ref.start !== at(start)) emit(ref);
      },
    );
  }
}

/** Report the references in the selectors of a token, which are interpolated. */
function scanSelectors(
  content: string,
  token: Token,
  at: At,
  emit: Emit,
  options: ReferenceOptions,
): void {
  if (
    !('selectorsStart' in token) ||
    token.selectorsStart === undefined ||
    token.selectorsEnd === undefined
  ) {
    return;
  }
  const from = token.selectorsStart;
  scanInterpolations(
    content.slice(from, token.selectorsEnd),
    (i) => at(from + i),
    emit,
    { ...options, storeVarMacros: NO_STORE_VAR_MACROS },
  );
}

/** Read a runtime binding and map its editable spans into the passage. */
function boundReference(
  token: Extract<Token, { type: 'macro' }>,
  at: At,
  all: boolean | undefined,
): VariableReference | undefined {
  try {
    const binding = parseBoundVariable(token.rawArgs);
    // Sigilless bindings are part of the complete editor list, but do not
    // change which references story startup checks.
    if (!binding || (!all && !binding.explicitSigil)) return undefined;
    const mapped = {
      ...binding,
      start: at(token.argsStart + binding.start),
      end: at(token.argsStart + binding.end),
      nameStart: at(token.argsStart + binding.nameStart),
      nameEnd: at(token.argsStart + binding.nameEnd),
    };
    return {
      sigil: '$',
      name: binding.name,
      path: binding.path,
      start: mapped.start,
      end: mapped.end,
      binding: mapped,
    };
  } catch {
    // Tolerant tooling skips bindings the runtime rejects.
    return undefined;
  }
}

/** Report the `$var` references in the tokens of `content`. */
function collectTokenRefs(
  content: string,
  tokens: Token[],
  at: At,
  emit: Emit,
  options: ReferenceOptions,
): void {
  const { storeVarMacros, parametersOf } = options;
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    if (
      options.all &&
      token.type !== 'macro' &&
      token.type !== 'html' &&
      token.type !== 'text'
    ) {
      scanSelectors(content, token, at, emit, options);
    }
    if (token.type === 'variable') {
      if (
        (token.scope === 'variable' || token.scope === 'transient') &&
        token.name
      ) {
        const [name, ...path] = token.name.split('.');
        emit({
          sigil: token.scope === 'variable' ? '$' : '%',
          name: name!,
          path,
          start: at(token.nameStart - 1),
          end: at(token.nameEnd),
        });
      }
    } else if (token.type === 'link') {
      scanInterpolations(
        token.display,
        (i) => at(token.displayStart + i),
        emit,
        { ...options, storeVarMacros: NO_STORE_VAR_MACROS },
      );
    } else if (token.type === 'expression') {
      scanCode(token.expression, (i) => at(token.expressionStart + i), emit);
    } else if (token.type === 'html') {
      for (const { name, value, at: valueAt } of attributeValues(
        content,
        token,
      )) {
        const valueIn: At = (i) => at(valueAt + i);
        if (isCodeAttribute(name)) scanSigilReferences(value, valueIn, emit);
        else scanInterpolations(value, valueIn, emit, options);
      }
    } else if (token.type === 'macro' && !token.isClose) {
      const binding =
        storeVarMacros.has(token.name.toLowerCase()) &&
        !parametersOf.widget?.(token.name)
          ? boundReference(token, at, options.all)
          : undefined;
      scanArgs(
        token,
        parametersOf,
        at,
        (ref) => {
          // A parameterless custom storeVar macro also scans its arguments
          // as code. Keep the binding's decoded path and span just once.
          if (!binding || ref.start < binding.start || ref.start >= binding.end)
            emit(ref);
        },
        options,
      );
      // Selectors (`{.{$cls} button}`) are interpolated when rendered
      scanSelectors(content, token, at, emit, options);

      if (binding) emit(binding);

      if (executesRawBody(token.name, parametersOf)) {
        // A {do} body is JavaScript: scan its source text as code, however
        // the markup tokens split it up.
        let close = t + 1;
        while (close < tokens.length) {
          const c = tokens[close]!;
          if (
            c.type === 'macro' &&
            c.isClose &&
            c.name.toLowerCase() === 'do'
          ) {
            break;
          }
          close++;
        }
        if (close < tokens.length) {
          const body = content.slice(token.end, tokens[close]!.start);
          scanCode(body, (i) => at(token.end + i), emit, 'statements');
          t = close;
        }
      }
    }
  }
}

/**
 * The `$` and `%` variable references a passage evaluates at runtime, in
 * source order: `{$var}` displays, `{$expr}` expressions, macro arguments and
 * `{do}` bodies (as code), quoted variable names bound by input macros, and
 * `{$…}` interpolations in labels and HTML attributes. Prose is literal text
 * and not scanned.
 */
export function collectVariableReferences(
  content: string,
  options: ReferenceOptions,
): VariableReference[] {
  const found: VariableReference[] = [];
  withParseCache(() =>
    collectTokenRefs(
      content,
      tokensOf(content, false, options),
      (i) => i,
      (ref) => found.push(ref),
      {
        ...options,
        expansionBudget: new MarkupExpansionBudget(content.length),
      },
    ),
  );
  // The scan visits a macro's arguments before its selectors, and bindings
  // after its arguments: the order of the source is the contract. (Stable,
  // so references written at one place keep the order they were found in.)
  return found.sort((a, b) => a.start - b.start);
}

/**
 * The invalid variable references of the passages, against what is declared,
 * with their positions. The passages that hold no markup (the declarations
 * themselves, SaveTitle) are skipped.
 */
export function checkVariableReferences(
  passages: Iterable<{ name: string; content: string }>,
  declared: VariableDeclarations,
  options: ReferenceOptions,
): VariableDiagnostic[] {
  const diagnostics: VariableDiagnostic[] = [];
  for (const passage of passages) {
    if (NOT_MARKUP.has(passage.name)) continue;
    for (const ref of collectVariableReferences(passage.content, options)) {
      const error = checkReference(ref, declared);
      if (!error) continue;
      diagnostics.push({
        passage: passage.name,
        code: error.code,
        name: ref.name,
        ...(ref.path.length > 0 ? { path: ref.path } : {}),
        start: ref.start,
        end: ref.end,
        message: error.message,
      });
    }
  }
  return diagnostics;
}

/**
 * Check the `$var` references of all passages against the schema, at story
 * start. Returns the error messages (empty = valid). (The syntax of their
 * code is checked with their markup: see markup/validate.ts.)
 *
 * `storeVarMacros` lists the input macros whose first argument names a bound
 * variable; it defaults to the built-in ones.
 */
export function validatePassages(
  passages: Map<string, Passage>,
  schema: Map<string, VariableSchema>,
  storeVarMacros: Iterable<string> = BUILTIN_STORE_VAR_MACROS,
  parametersOf: ParametersOf = getMacroParameters,
): string[] {
  return checkVariableReferences(
    passages.values(),
    { variables: schema },
    {
      storeVarMacros: new Set(
        Array.from(storeVarMacros, (m) => m.toLowerCase()),
      ),
      parametersOf,
    },
  ).map((d) => `Passage "${d.passage}": ${d.message}`);
}

/**
 * Extract default values from the schema as a record without a prototype,
 * like the namespaces it initializes (see utils/namespace.ts).
 */
export function extractDefaults(
  schema: Map<string, VariableSchema>,
): Record<string, unknown> {
  const defaults = createNamespace();
  for (const [name, varSchema] of schema) {
    defaults[name] = varSchema.default;
  }
  return defaults;
}
