import type { Passage } from './parser';

export type VarType = 'number' | 'string' | 'boolean' | 'array' | 'object';

export interface FieldSchema {
  type: VarType;
  fields?: Map<string, FieldSchema>; // only for objects
}

export interface VariableSchema extends FieldSchema {
  name: string;
  default: unknown;
}

const DECLARATION_RE = /^\$(\w+)\s*=\s*(.+)$/;
const VAR_REF_RE = /\$(\w+(?:\.\w+)*)/g;
const FOR_LOCAL_RE = /\{for\s+@(\w+)(?:\s*,\s*@(\w+))?\s+of\b/g;

const VALID_VAR_TYPES = new Set<string>(['number', 'string', 'boolean']);

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
      `StoryVariables: Unsupported type "${jsType}" for value ${String(value)}. Expected number, string, boolean, array, or object.`,
    );
  }
  return { type: jsType as VarType };
}

/**
 * Parse a StoryVariables passage content into a schema map.
 * Each line: `$varName = expression`
 */
export function parseStoryVariables(
  content: string,
): Map<string, VariableSchema> {
  const schema = new Map<string, VariableSchema>();

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(DECLARATION_RE);
    if (!match) {
      throw new Error(
        `StoryVariables: Invalid declaration: "${line}". Expected: $name = value`,
      );
    }

    const [, name, expr] = match as [string, string, string];
    let value: unknown;
    try {
      value = new Function('return (' + expr + ')')();
    } catch (err) {
      throw new Error(
        `StoryVariables: Failed to evaluate "$${name} = ${expr}": ${err instanceof Error ? err.message : err}`,
      );
    }

    const fieldSchema = inferSchema(value);
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
 * Scan all passages for $var references, check against schema.
 * Returns list of error messages (empty = valid).
 */
export function validatePassages(
  passages: Map<string, Passage>,
  schema: Map<string, VariableSchema>,
): string[] {
  const errors: string[] = [];

  for (const [name, passage] of passages) {
    // Don't validate the StoryVariables passage itself
    if (name === 'StoryVariables') continue;

    const forLocals = extractForLocals(passage.content);

    let match: RegExpExecArray | null;
    VAR_REF_RE.lastIndex = 0;
    while ((match = VAR_REF_RE.exec(passage.content)) !== null) {
      const ref = match[1]!;
      const error = validateRef(ref, schema, forLocals);
      if (error) {
        errors.push(`Passage "${name}": ${error}`);
      }
    }
  }

  return errors;
}

/**
 * Extract default values from the schema as a plain object.
 */
export function extractDefaults(
  schema: Map<string, VariableSchema>,
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [name, varSchema] of schema) {
    defaults[name] = varSchema.default;
  }
  return defaults;
}
