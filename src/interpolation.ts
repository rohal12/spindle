/**
 * Text-only markup: HTML attribute values, image alt text and link titles,
 * and macro labels resolve the inline markup of passage text (variables,
 * expressions, macros, widgets) to a string.
 *
 * Such a value is parsed with the passage parser in text mode, so `{…}`
 * means the same as in passage text, and its AST is evaluated directly to a
 * string rather than rendered: the result is ready during the render that
 * needs it (so it goes through the usual attribute handling, boolean
 * attributes and live properties included), costs no DOM work, and is
 * recomputed whenever the variables or locals the caller subscribes to
 * change. Macros take part through their text form (MacroDefinition.text);
 * one without a text form (inputs, links, {set}, …) has nothing to put in a
 * string, so it is reported instead of being run or shown as source.
 */
import { evaluate } from './expression';
import {
  SCOPE_SIGILS,
  SIGIL_SCOPES,
  type VariableScope,
} from './markup/tokens';
import type { Sigil } from './js-lexer';
import { parseMarkup } from './markup/parse';
import type { ASTNode, MacroNode, TextNode } from './markup/ast';
import { getMacro, getMacroText, isSubMacro } from './registry';
import type { MacroTextContext } from './registry';
import { getWidget } from './widgets/widget-registry';
import { splitArgs } from './components/macros/arg-utils';
import { display } from './components/macros/display';
import { splitSigilTemplate } from './markup/code-attributes';
import {
  checkVariableName,
  createNamespace,
  ownValue,
  type Namespace,
} from './utils/namespace';

/** Whether a string may contain markup (anything but plain text). */
export function hasInterpolation(s: string): boolean {
  return s.includes('{') || s.includes('}');
}

/** The scope text-only markup is evaluated in. */
export interface TextScope {
  variables: Record<string, unknown>;
  temporary: Record<string, unknown>;
  locals: Record<string, unknown>;
  transient: Record<string, unknown>;
  /** Invocation children of the enclosing block widget, for `{@children}`. */
  widgetChildren?: ASTNode[] | null;
}

/** A macro, expression or markup error met while evaluating text. */
export interface TextError {
  /** The macro name, or `expression` / `markup`. */
  macro: string;
  error: unknown;
}

export interface TextResult {
  text: string;
  errors: TextError[];
}

export type ParsedText = { nodes: ASTNode[] } | { error: unknown };

const parseCache = new Map<string, ParsedText>();
const PARSE_CACHE_LIMIT = 2000;

/**
 * Parse text-only markup into AST nodes, or the error the AST builder
 * reports for it (an unclosed or mismatched macro). Results are cached.
 */
export function parseText(template: string): ParsedText {
  let parsed = parseCache.get(template);
  if (parsed === undefined) {
    try {
      parsed = { nodes: parseMarkup(template, { text: true }) };
    } catch (error) {
      parsed = { error };
    }
    if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.clear();
    parseCache.set(template, parsed);
  }
  return parsed;
}

/** Map the text nodes of an AST (macro bodies and branches included). */
export function mapTextNodes(
  nodes: ASTNode[],
  fn: (value: string) => string,
): ASTNode[] {
  return nodes.map((node): ASTNode => {
    switch (node.type) {
      case 'text':
        return { type: 'text', value: fn(node.value) } satisfies TextNode;
      case 'html':
        return { ...node, children: mapTextNodes(node.children, fn) };
      case 'macro': {
        const copy: MacroNode = {
          ...node,
          children: mapTextNodes(node.children, fn),
        };
        if (node.branches) {
          copy.branches = node.branches.map((b) => ({
            ...b,
            children: mapTextNodes(b.children, fn),
          }));
        }
        return copy;
      }
      default:
        return node;
    }
  });
}

/** Deep enough for any real nesting; stops a widget that includes itself. */
const MAX_DEPTH = 100;

/**
 * The value of a variable reference (`name` without its sigil, with an
 * optional dot path), as `{$name}` shows it in passage text (see
 * VarDisplay): the variable is read from its namespace's own entries only,
 * so an unset `$toString` is undefined, and one named `__proto__` throws.
 */
function resolveVariable(
  scope: TextScope,
  kind: VariableScope,
  name: string,
): unknown {
  const parts = name.split('.');
  const root = parts[0]!;
  checkVariableName(root, SCOPE_SIGILS[kind] + root);
  const store =
    kind === 'variable'
      ? scope.variables
      : kind === 'temporary'
        ? scope.temporary
        : kind === 'transient'
          ? scope.transient
          : scope.locals;
  // Own entries only, as the expression engine reads them
  let value = ownValue(store, root);
  // Primitives box on access, so `{$name.length}` works too.
  for (let i = 1; i < parts.length; i++) {
    if (value == null) return undefined;
    value = (value as Record<string, unknown>)[parts[i]!];
  }
  return value;
}

/** Evaluate an expression in `scope`. */
function evaluateIn(expr: string, scope: TextScope): unknown {
  return evaluate(
    expr,
    scope.variables,
    scope.temporary,
    scope.locals,
    scope.transient,
  );
}

class TextEvaluator {
  readonly errors: TextError[] = [];

  nodes(nodes: ASTNode[], scope: TextScope, depth: number): string {
    let text = '';
    for (const node of nodes) text += this.node(node, scope, depth);
    return text;
  }

  private node(node: ASTNode, scope: TextScope, depth: number): string {
    switch (node.type) {
      case 'text':
        return node.value;
      case 'variable':
        if (node.scope === 'local' && node.name === 'children') {
          // As {@children} in a widget body: the invocation's children, in
          // the scope of the body.
          const children = scope.widgetChildren;
          if (!children) return '';
          return this.nested('children', children, scope, depth, {
            widgetChildren: null,
          });
        }
        return this.variable(node.scope, node.name, scope);
      case 'expression':
        try {
          return display(evaluateIn(node.expression, scope));
        } catch (error) {
          this.errors.push({ macro: 'expression', error });
          return '';
        }
      case 'html':
        return this.nodes(node.children, scope, depth);
      case 'macro':
        return this.macro(node, scope, depth);
      default: {
        const _exhaustive: never = node;
        return _exhaustive;
      }
    }
  }

  /** A variable reference, or '' and an error if it can't be one. */
  private variable(
    kind: VariableScope,
    name: string,
    scope: TextScope,
  ): string {
    try {
      return display(resolveVariable(scope, kind, name));
    } catch (error) {
      // Reported as passage text reports it: `{$__proto__ error: …}`
      this.errors.push({ macro: SCOPE_SIGILS[kind] + name, error });
      return '';
    }
  }

  private nested(
    macro: string,
    nodes: ASTNode[],
    scope: TextScope,
    depth: number,
    changes: Partial<TextScope> = {},
  ): string {
    if (depth >= MAX_DEPTH) {
      this.errors.push({
        macro,
        error: new Error('markup nested too deeply (a widget using itself?)'),
      });
      return '';
    }
    return this.nodes(nodes, { ...scope, ...changes }, depth + 1);
  }

  private macro(node: MacroNode, scope: TextScope, depth: number): string {
    // Rendering ignores a stray sub-macro too (see renderMacro).
    if (isSubMacro(node.name)) return '';

    const widget = getWidget(node.name);
    if (widget) {
      let locals = scope.locals;
      // Parameterized widgets get their own scope (see WidgetInvocation):
      // a missing or failing argument is undefined.
      if (widget.params.length > 0) {
        const argExprs = node.rawArgs ? splitArgs(node.rawArgs) : [];
        locals = createNamespace(scope.locals);
        widget.params.forEach((param, i) => {
          let value: unknown;
          const expr = argExprs[i];
          if (expr !== undefined) {
            try {
              value = evaluateIn(expr, scope);
            } catch {
              value = undefined;
            }
          }
          locals[param.startsWith('@') ? param.slice(1) : param] = value;
        });
      }
      return this.nested(node.name, widget.body, scope, depth, {
        locals,
        widgetChildren: node.children.length > 0 ? node.children : null,
      });
    }

    const text = getMacroText(node.name);
    if (!text) {
      const message = getMacro(node.name)
        ? `{${node.name}} has no text form, so it can't be used in an attribute value or label`
        : `unknown macro {${node.name}}`;
      this.errors.push({ macro: node.name, error: new Error(message) });
      return '';
    }

    const ctx: MacroTextContext = {
      evaluate: (expr) => evaluateIn(expr, scope),
      renderText: (nodes, locals) =>
        this.nested(
          node.name,
          nodes,
          scope,
          depth,
          locals ? { locals: withLocals(scope.locals, locals) } : {},
        ),
    };
    try {
      return text(
        {
          rawArgs: node.rawArgs,
          className: node.className,
          id: node.id,
          children: node.children,
          branches: node.branches,
        },
        ctx,
      );
    } catch (error) {
      this.errors.push({ macro: node.name, error });
      return '';
    }
  }
}

/**
 * The locals `ns` with `added` (keys without `@`) on top, as a namespace
 * (see utils/namespace.ts). A name no namespace can hold throws.
 */
function withLocals(ns: Namespace, added: Record<string, unknown>): Namespace {
  for (const key of Object.keys(added)) checkVariableName(key, `@${key}`);
  return createNamespace(ns, added);
}

/** Evaluate parsed text-only markup to a string. */
export function renderText(nodes: ASTNode[], scope: TextScope): TextResult {
  const evaluator = new TextEvaluator();
  const text = evaluator.nodes(nodes, scope, 0);
  return { text, errors: evaluator.errors };
}

/**
 * Evaluate text-only markup. Markup that doesn't parse (an unclosed
 * `{if}`) is reported and kept as written.
 */
export function interpolateText(
  template: string,
  scope: TextScope,
): TextResult {
  if (!hasInterpolation(template)) return { text: template, errors: [] };
  const parsed = parseText(template);
  if ('error' in parsed) {
    return {
      text: template,
      errors: [{ macro: 'markup', error: parsed.error }],
    };
  }
  return renderText(parsed.nodes, scope);
}

/**
 * Resolve the sigil references in the value of a code attribute (see
 * isCodeAttribute): `{$x}`, `{_x.y}`, `{$n + 1}`. Everything else, other
 * braces included, is literal text, passed through `decode` when given.
 * A reference whose expression fails is reported and left empty.
 */
export function interpolateCode(
  template: string,
  scope: TextScope,
  decode?: (text: string) => string,
): TextResult {
  const errors: TextError[] = [];
  let text = '';
  for (const part of splitSigilTemplate(template)) {
    if ('text' in part) {
      text += decode ? decode(part.text) : part.text;
    } else if ('verbatim' in part) {
      text += part.verbatim;
    } else if (/^[$_@%][\w.]+$/.test(part.expr)) {
      const kind = SIGIL_SCOPES[part.expr[0] as Sigil];
      try {
        text += display(resolveVariable(scope, kind, part.expr.slice(1)));
      } catch (error) {
        errors.push({ macro: part.expr, error });
      }
    } else {
      try {
        text += display(evaluateIn(part.expr, scope));
      } catch (error) {
        errors.push({ macro: 'expression', error });
      }
    }
  }
  return { text, errors };
}

/** The namespaces of a TextScope, passed one by one. */
type ScopeArgs = [
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient?: Record<string, unknown>,
];

function scopeOf(
  ...[variables, temporary, locals, transient = {}]: ScopeArgs
): TextScope {
  return { variables, temporary, locals, transient };
}

/**
 * Evaluate text-only markup to a string, throwing the first error met.
 */
export function interpolate(
  template: string,
  ...namespaces: ScopeArgs
): string {
  const { text, errors } = interpolateText(template, scopeOf(...namespaces));
  if (errors.length > 0) throw errors[0]!.error;
  return text;
}

/**
 * Evaluate an expression string and return its stringified result.
 * Uses the full expression evaluator from expression.ts.
 */
export function interpolateExpression(
  expr: string,
  ...namespaces: ScopeArgs
): string {
  return display(evaluateIn(expr, scopeOf(...namespaces)));
}
