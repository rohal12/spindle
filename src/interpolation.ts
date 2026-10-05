/**
 * Text-only markup: HTML attribute values, image alt text and link titles,
 * and macro labels resolve the inline markup of passage text (variables,
 * expressions, macros, widgets) to a string.
 *
 * Such a value is parsed with the passage tokenizer in text mode, so `{…}`
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
import { tokenize } from './markup/tokenizer';
import { buildAST } from './markup/ast';
import type { ASTNode, MacroNode, TextNode } from './markup/ast';
import { getMacro, getMacroText, isSubMacro } from './registry';
import type { MacroTextContext } from './registry';
import { getWidget } from './widgets/widget-registry';
import { splitArgs } from './components/macros/arg-utils';

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
      parsed = { nodes: buildAST(tokenize(template, { text: true })) };
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

function display(value: unknown): string {
  return value == null ? '' : String(value);
}

function resolveVariable(
  scope: TextScope,
  kind: 'variable' | 'temporary' | 'local' | 'transient',
  name: string,
): unknown {
  const parts = name.split('.');
  const store =
    kind === 'variable'
      ? scope.variables
      : kind === 'temporary'
        ? scope.temporary
        : kind === 'transient'
          ? scope.transient
          : scope.locals;
  let value = store[parts[0]!];
  // Primitives box on access, so `{$name.length}` works too.
  for (let i = 1; i < parts.length; i++) {
    if (value == null) return undefined;
    value = (value as Record<string, unknown>)[parts[i]!];
  }
  return value;
}

class TextEvaluator {
  readonly errors: TextError[] = [];

  nodes(nodes: ASTNode[], scope: TextScope, depth: number): string {
    let text = '';
    for (const node of nodes) text += this.node(node, scope, depth);
    return text;
  }

  private evaluate(expr: string, scope: TextScope): unknown {
    return evaluate(
      expr,
      scope.variables,
      scope.temporary,
      scope.locals,
      scope.transient,
    );
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
        return display(resolveVariable(scope, node.scope, node.name));
      case 'expression':
        try {
          return display(this.evaluate(node.expression, scope));
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
        locals = { ...scope.locals };
        widget.params.forEach((param, i) => {
          let value: unknown;
          const expr = argExprs[i];
          if (expr !== undefined) {
            try {
              value = this.evaluate(expr, scope);
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
      evaluate: (expr) => this.evaluate(expr, scope),
      renderText: (nodes, locals) =>
        this.nested(
          node.name,
          nodes,
          scope,
          depth,
          locals ? { locals: { ...scope.locals, ...locals } } : {},
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
 * Evaluate text-only markup to a string, throwing the first error met.
 */
export function interpolate(
  template: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown> = {},
): string {
  const { text, errors } = interpolateText(template, {
    variables,
    temporary,
    locals,
    transient,
  });
  if (errors.length > 0) throw errors[0]!.error;
  return text;
}

/**
 * Evaluate an expression string and return its stringified result.
 * Uses the full expression evaluator from expression.ts.
 */
export function interpolateExpression(
  expr: string,
  variables: Record<string, unknown>,
  temporary: Record<string, unknown>,
  locals: Record<string, unknown>,
  transient: Record<string, unknown> = {},
): string {
  return display(evaluate(expr, variables, temporary, locals, transient));
}
