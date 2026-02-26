import type { Passage } from "./parser";

export type VarType = "number" | "string" | "boolean" | "array" | "object";

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
const FOR_LOCAL_RE = /\{for\s+(\$\w+)(?:\s*,\s*(\$\w+))?\s+of\b/g;

function inferSchema(value: unknown): FieldSchema {
  if (Array.isArray(value)) {
    return { type: "array" };
  }
  if (value !== null && typeof value === "object") {
    const fields = new Map<string, FieldSchema>();
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      fields.set(key, inferSchema(val));
    }
    return { type: "object", fields };
  }
  return { type: typeof value as VarType };
}

/**
 * Parse a StoryVariables passage content into a schema map.
 * Each line: `$varName = expression`
 */
export function parseStoryVariables(
  content: string
): Map<string, VariableSchema> {
  const schema = new Map<string, VariableSchema>();

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const match = line.match(DECLARATION_RE);
    if (!match) {
      throw new Error(
        `StoryVariables: Invalid declaration: "${line}". Expected: $name = value`
      );
    }

    const [, name, expr] = match;
    let value: unknown;
    try {
      value = new Function("return (" + expr + ")")();
    } catch (err) {
      throw new Error(
        `StoryVariables: Failed to evaluate "$${name} = ${expr}": ${err instanceof Error ? err.message : err}`
      );
    }

    const fieldSchema = inferSchema(value);
    schema.set(name, { ...fieldSchema, name, default: value });
  }

  return schema;
}

/**
 * Extract for-loop local variable names from passage content.
 * `{for $item of ...}` → "item"
 * `{for $index, $item of ...}` → "index", "item"
 */
function extractForLocals(content: string): Set<string> {
  const locals = new Set<string>();
  let match: RegExpExecArray | null;
  FOR_LOCAL_RE.lastIndex = 0;
  while ((match = FOR_LOCAL_RE.exec(content)) !== null) {
    locals.add(match[1].slice(1)); // strip $
    if (match[2]) locals.add(match[2].slice(1));
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
  forLocals: Set<string>
): string | null {
  const parts = ref.split(".");
  const rootName = parts[0];

  // Skip for-loop locals
  if (forLocals.has(rootName)) return null;

  const rootSchema = schema.get(rootName);
  if (!rootSchema) {
    return `Undeclared variable: $${ref}`;
  }

  // Walk through field access path
  let current: FieldSchema = rootSchema;
  for (let i = 1; i < parts.length; i++) {
    if (current.type !== "object" || !current.fields) {
      return `Cannot access field "${parts[i]}" on $${parts.slice(0, i).join(".")} (type: ${current.type})`;
    }
    const fieldSchema = current.fields.get(parts[i]);
    if (!fieldSchema) {
      return `Undeclared field: $${parts.slice(0, i + 1).join(".")}`;
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
  schema: Map<string, VariableSchema>
): string[] {
  const errors: string[] = [];

  for (const [name, passage] of passages) {
    // Don't validate the StoryVariables passage itself
    if (name === "StoryVariables") continue;

    const forLocals = extractForLocals(passage.content);

    let match: RegExpExecArray | null;
    VAR_REF_RE.lastIndex = 0;
    while ((match = VAR_REF_RE.exec(passage.content)) !== null) {
      const ref = match[1];
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
  schema: Map<string, VariableSchema>
): Record<string, unknown> {
  const defaults: Record<string, unknown> = {};
  for (const [name, varSchema] of schema) {
    defaults[name] = varSchema.default;
  }
  return defaults;
}
