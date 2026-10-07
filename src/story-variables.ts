import type { Passage } from './parser';
import type { Token } from './markup/tokens';
import { MarkupError, tokenizeMarkup } from './markup/parse';
import { isCodeAttribute, splitSigilTemplate } from './markup/code-attributes';
import { errorMessage } from './utils/error-message';
import {
  CodeSyntaxError,
  lexJs,
  scanStringLiteral,
  type JsGoal,
} from './js-lexer';
import {
  argPieces,
  holdsCode,
  parseOrError,
  withParseCache,
  type ParametersOf,
} from './code-check';
import { getMacroParameters, type ParameterDef } from './registry';
import { NOT_MARKUP } from './markup/validate';
import { createNamespace, variableNameError } from './utils/namespace';

/**
 * The tokens of markup, or none if it is malformed: validateMarkup reports
 * that, with its position.
 */
function tokensOf(text: string, textMode: boolean): Token[] {
  try {
    return tokenizeMarkup(text, { text: textMode });
  } catch (err) {
    if (err instanceof MarkupError) return [];
    throw err;
  }
}

export type VarType = 'number' | 'string' | 'boolean' | 'array' | 'object';

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
/** A `$name` reference with its dot path, at a `$` the lexer found. */
const VAR_PATH_RE = /\$(\w+(?:\.\w+)*)/y;
/** Quoted first argument of an input macro naming a story variable. */
const QUOTED_VAR_ARG_RE = /^["']\$(\w+(?:\.\w+)*)["']?$/;
const FOR_LOCAL_RE = /\{for\s+@(\w+)(?:\s*,\s*@(\w+))?\s+of\b/g;

const VALID_VAR_TYPES = new Set<string>(['number', 'string', 'boolean']);

/** Boxed sample values whose members a primitive of each type can access. */
const PRIMITIVE_SAMPLES: Partial<Record<VarType, object>> = {
  string: Object(''),
  number: Object(0),
  boolean: Object(false),
};

function inferSchema(value: unknown): FieldSchema {
  if (Array.isArray(value)) {
    return { type: 'array' };
  }
  if (value !== null && typeof value === 'object') {
    const fields = new Map<string, FieldSchema>();
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      fields.set(key, inferSchema(val));
    }
    return { type: 'object', fields };
  }
  const jsType = typeof value;
  if (!VALID_VAR_TYPES.has(jsType)) {
    throw new Error(
      `Unsupported type "${jsType}" for value ${String(value)}. Expected number, string, boolean, array, or object.`,
    );
  }
  return { type: jsType as VarType };
}

/**
 * Parse a StoryVariables or StoryTransients passage content into a schema map.
 * Each line: `$varName = expression` (or `%varName = expression` for transients)
 */
export function parseStoryVariables(
  content: string,
  sigil: '$' | '%' = '$',
): Map<string, VariableSchema> {
  const schema = new Map<string, VariableSchema>();
  const DECLARATION_RE = declarationRegex(sigil);
  const passageName = sigil === '%' ? 'StoryTransients' : 'StoryVariables';

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(DECLARATION_RE);
    if (!match) {
      throw new Error(
        `${passageName}: Invalid declaration: "${line}". Expected: ${sigil}name = value`,
      );
    }

    const [, name, expr] = match as [string, string, string];
    const nameError = variableNameError(name, sigil + name);
    if (nameError) throw new Error(`${passageName}: ${nameError}`);
    let value: unknown;
    try {
      value = new Function('return (' + expr + ')')();
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

/**
 * Extract for-loop local variable names from passage content.
 * `{for @item of ...}` → "item"
 * `{for @index, @item of ...}` → "index", "item"
 */
function extractForLocals(content: string): Set<string> {
  const locals = new Set<string>();
  let match: RegExpExecArray | null;
  FOR_LOCAL_RE.lastIndex = 0;
  while ((match = FOR_LOCAL_RE.exec(content)) !== null) {
    locals.add(match[1]!);
    if (match[2]) locals.add(match[2]!);
  }
  return locals;
}

/**
 * Validate a single variable reference path (e.g. "player.health") against
 * the schema. Returns an error message or null if valid.
 */
function validateRef(
  ref: string,
  schema: Map<string, VariableSchema>,
  forLocals: Set<string>,
): string | null {
  const parts = ref.split('.');
  const rootName = parts[0]!;

  const nameError = variableNameError(rootName, '$' + rootName);
  if (nameError) return nameError;

  // Skip for-loop locals
  if (forLocals.has(rootName)) return null;

  const rootSchema = schema.get(rootName);
  if (!rootSchema) {
    return `Undeclared variable: $${ref}`;
  }

  // Walk through field access path
  let current: FieldSchema = rootSchema;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] as string;

    // Arrays have built-in methods/properties (push, find, length, etc.)
    // so any field access on an array is allowed.
    if (current.type === 'array') return null;

    // Primitives expose their wrapper's built-ins (length, toUpperCase,
    // toFixed, etc.). Keep validating past properties of primitive type.
    const sample = PRIMITIVE_SAMPLES[current.type];
    if (sample && part in sample) {
      const member: unknown = sample[part as keyof typeof sample];
      const memberType = typeof member;
      if (!VALID_VAR_TYPES.has(memberType)) return null;
      current = { type: memberType as VarType };
      continue;
    }

    if (current.type !== 'object' || !current.fields) {
      return `Cannot access field "${part}" on $${parts.slice(0, i).join('.')} (type: ${current.type})`;
    }
    const fieldSchema = current.fields.get(part);
    if (!fieldSchema) {
      // Unknown fields on objects are allowed — classes registered via
      // Story.registerClass() can add methods/getters not in the defaults.
      return null;
    }
    current = fieldSchema;
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

type RefCallback = (ref: string) => void;

const NO_STORE_VAR_MACROS: ReadonlySet<string> = new Set();

/**
 * Scan the value of a code attribute (`onclick`, see isCodeAttribute) for
 * the `{$…}` references resolved in it; its other braces are code.
 */
function scanSigilReferences(value: string, onRef: RefCallback): void {
  for (const part of splitSigilTemplate(value)) {
    if ('expr' in part) scanCode(part.expr, onRef);
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
  onRef: RefCallback,
  storeVarMacros: ReadonlySet<string> = NO_STORE_VAR_MACROS,
): void {
  if (!text.includes('{')) return;
  collectTokenRefs(text, tokensOf(text, true), storeVarMacros, onRef);
}

/**
 * Report `$var` references in JavaScript code, lexed as the expression
 * engine lexes it (`lexJs`): references in code, but none inside string or
 * regex literals or comments, nor property names (`a.$b`, `{ $b: 1 }`).
 * The text of string and template literals is scanned for the markup that
 * labels evaluate (`{$…}`); the `${…}` parts of template literals are code.
 */
function scanCode(
  code: string,
  onRef: RefCallback,
  goal: JsGoal = 'expression',
): void {
  const parsed = parseOrError(code, goal);
  if (parsed instanceof CodeSyntaxError) {
    scanCodeLeniently(code, onRef, goal);
    return;
  }
  for (const ref of parsed.refs) {
    if (ref.sigil !== '$') continue;
    VAR_PATH_RE.lastIndex = ref.start;
    onRef(VAR_PATH_RE.exec(code)![1]!);
  }
  for (const text of parsed.strings) scanInterpolations(text, onRef);
}

/** `scanCode` for code acorn can't parse: lexed leniently. */
function scanCodeLeniently(
  code: string,
  onRef: RefCallback,
  goal: JsGoal,
): void {
  /** Open template literals: their text so far, null in an interpolation. */
  const templates: { nesting: number; text: string | null }[] = [];
  lexJs(
    code,
    {
      variable(sigil, _name, index) {
        if (sigil !== '$') return;
        VAR_PATH_RE.lastIndex = index;
        onRef(VAR_PATH_RE.exec(code)![1]!);
      },
      literal(text, _index, nesting) {
        const template = templates[templates.length - 1];
        if (template?.nesting === nesting) {
          if (template.text === null) {
            // The `}` ending an interpolation: back to the template's text
            template.text = '';
          } else if (text === '`' || text === '${') {
            scanInterpolations(template.text, onRef);
            if (text === '`') templates.pop();
            else template.text = null;
          } else {
            template.text += text;
          }
        } else if (text === '`') {
          templates.push({ nesting, text: '' });
        } else if (text[0] === '"' || text[0] === "'") {
          const { closed } = scanStringLiteral(text, 0);
          scanInterpolations(text.slice(1, closed ? -1 : undefined), onRef);
        }
        // Regex literals and comments hold no references
      },
    },
    goal,
  );
  // An unterminated template literal's text
  for (const t of templates) if (t.text) scanInterpolations(t.text, onRef);
}

/**
 * Report the `$var` references a passage evaluates at runtime: `{$var}`
 * displays, `{$expr}` expressions, macro arguments and `{do}` bodies (as
 * code), quoted variable names bound by input macros, and `{$…}`
 * interpolations in HTML attributes. Prose is literal text and not scanned.
 */
function collectPassageRefs(
  content: string,
  storeVarMacros: ReadonlySet<string>,
  onRef: RefCallback,
  parametersOf: ParametersOf,
): void {
  withParseCache(() =>
    collectTokenRefs(
      content,
      tokensOf(content, false),
      storeVarMacros,
      onRef,
      parametersOf,
    ),
  );
}

/**
 * Report the references in the code that a macro's quoted arguments hold
 * (see ParameterDef.holds), the condition and `run` action of `{watch}`:
 * the argument scan sees only the strings. Only the macros that declare
 * code in a string have their arguments read.
 */
function scanStringCode(
  token: Extract<Token, { type: 'macro' }>,
  params: readonly ParameterDef[] | undefined,
  onRef: RefCallback,
): void {
  if (!params || !token.rawArgs || !holdsCode(params)) return;
  for (const piece of argPieces(token.rawArgs, 0, params, token.name, '')) {
    if (piece.kind === 'code' && piece.inString) {
      scanCode(piece.code, onRef, piece.goal);
    }
  }
}

/** Report the `$var` references in the tokens of `content`. */
function collectTokenRefs(
  content: string,
  tokens: Token[],
  storeVarMacros: ReadonlySet<string>,
  onRef: RefCallback,
  parametersOf: ParametersOf = () => undefined,
): void {
  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t]!;
    if (token.type === 'variable') {
      if (token.scope === 'variable' && token.name) onRef(token.name);
    } else if (token.type === 'expression') {
      scanCode(token.expression, onRef);
    } else if (token.type === 'html') {
      for (const [name, value] of Object.entries(token.attributes)) {
        if (isCodeAttribute(name)) scanSigilReferences(value, onRef);
        else scanInterpolations(value, onRef, storeVarMacros);
      }
    } else if (token.type === 'macro' && !token.isClose) {
      scanCode(token.rawArgs, onRef);
      scanStringCode(token, parametersOf(token.name), onRef);

      if (storeVarMacros.has(token.name.toLowerCase())) {
        const first = token.rawArgs.trim().split(/\s+/)[0] ?? '';
        const quoted = QUOTED_VAR_ARG_RE.exec(first);
        if (quoted) onRef(quoted[1]!);
      }

      if (token.name === 'do') {
        // A {do} body is JavaScript: scan its source text as code, however
        // the markup tokens split it up.
        let close = t + 1;
        while (close < tokens.length) {
          const c = tokens[close]!;
          if (c.type === 'macro' && c.isClose && c.name === 'do') break;
          close++;
        }
        if (close < tokens.length) {
          const body = content.slice(token.end, tokens[close]!.start);
          scanCode(body, onRef, 'statements');
          t = close;
        }
      }
    }
  }
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
  const errors: string[] = [];
  const storeVarSet = new Set(
    Array.from(storeVarMacros, (m) => m.toLowerCase()),
  );

  for (const [name, passage] of passages) {
    // Don't validate the declarations or the SaveTitle code themselves
    if (NOT_MARKUP.has(name)) continue;

    const forLocals = extractForLocals(passage.content);
    collectPassageRefs(
      passage.content,
      storeVarSet,
      (ref) => {
        const error = validateRef(ref, schema, forLocals);
        if (error) {
          errors.push(`Passage "${name}": ${error}`);
        }
      },
      parametersOf,
    );
  }

  return errors;
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
