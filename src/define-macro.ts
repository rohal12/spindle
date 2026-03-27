import { h, Fragment } from 'preact';
import type { VNode, ComponentChildren } from 'preact';
import {
  useContext,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
} from 'preact/hooks';
import { useInterpolate } from './hooks/use-interpolate';
import { useMergedLocals } from './hooks/use-merged-locals';
import {
  LocalsUpdateContext,
  LocalsValuesContext,
  NobrContext,
  renderNodes as _renderNodes,
  renderInlineNodes,
} from './markup/render';
import type { ASTNode } from './markup/ast';
import { executeMutation } from './execute-mutation';
import { evaluate } from './expression';
import { useStoryStore } from './store';
import { useAction } from './hooks/use-action';
import type { UseActionOptions } from './hooks/use-action';
import { collectText } from './utils/extract-text';
import { currentSourceLocation } from './utils/source-location';
import { parseVarArgs, extractOptions } from './components/macros/option-utils';
import {
  registerMacro,
  registerSubMacro,
  registerMacroMetadata,
} from './registry';
import type { MacroProps, ParameterDef } from './registry';
import { registerBlockMacro } from './markup/ast';

export function macroClass(type: string, className?: string): string {
  const base = `macro-${type}`;
  return className ? `${base} ${className}` : base;
}

export interface MacroContext {
  className?: string;
  id?: string;
  resolve?: (s: string | undefined) => string | undefined;
  cls: string;
  mutate: (code: string) => void;
  update: (key: string, value: unknown) => void;
  getValues: () => Record<string, unknown>;
  merged?: readonly [
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
    Record<string, unknown>,
  ];
  varName?: string;
  value?: unknown;
  setValue?: (value: unknown) => void;
  getValue?: () => unknown;
  evaluate?: (expr: string) => unknown;
  collectText: typeof collectText;
  sourceLocation: typeof currentSourceLocation;
  parseVarArgs: typeof parseVarArgs;
  extractOptions: typeof extractOptions;
  wrap: (content: ComponentChildren) => VNode<any>;
  useAction: (opts: UseActionOptions) => string;
  h: typeof h;
  renderNodes: typeof _renderNodes;
  renderInlineNodes: typeof renderInlineNodes;
  hooks: {
    useState: typeof useState;
    useRef: typeof useRef;
    useEffect: typeof useEffect;
    useLayoutEffect: typeof useLayoutEffect;
    useCallback: typeof useCallback;
    useMemo: typeof useMemo;
    useContext: typeof useContext;
  };
}

export interface MacroDefinition {
  name: string;
  subMacros?: string[];
  block?: boolean;
  interpolate?: boolean;
  merged?: boolean;
  storeVar?: boolean;
  description?: string;
  parameters?: ParameterDef[];
  render: (props: MacroProps, ctx: MacroContext) => VNode | null;
}

const sharedHooks = {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useContext,
};

/** Traverse a dot-path on an object, returning the nested value. */
function getByPath(obj: Record<string, unknown>, segments: string[]): unknown {
  let current: unknown = obj;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/** Set a nested value by dot-path segments on an (Immer draft) object. */
function setByPath(
  obj: Record<string, unknown>,
  segments: string[],
  value: unknown,
): void {
  let target: Record<string, unknown> = obj;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    if (target[seg] == null || typeof target[seg] !== 'object') {
      target[seg] = {};
    }
    target = target[seg] as Record<string, unknown>;
  }
  target[segments[segments.length - 1]!] = value;
}

export function defineMacro(
  config: MacroDefinition,
  source: 'builtin' | 'user' = 'builtin',
): void {
  function Wrapper(props: MacroProps) {
    // className/id resolved first (interpolate may transform them)
    let className = props.className;
    let id = props.id;
    let resolve: ((s: string | undefined) => string | undefined) | undefined;
    if (config.interpolate) {
      resolve = useInterpolate();
      className = resolve(className);
      id = resolve(id);
    }

    // Always-on: cssClass + mutation
    const { update, getValues } = useContext(LocalsUpdateContext);
    const nobr = useContext(NobrContext);
    const localsValues = useContext(LocalsValuesContext);
    const renderNodes = (
      nodes: ASTNode[],
      options?: { nobr?: boolean; locals?: Record<string, unknown> },
    ) => _renderNodes(nodes, { nobr, locals: localsValues, ...options });
    const ctx: MacroContext = {
      collectText,
      sourceLocation: currentSourceLocation,
      parseVarArgs,
      extractOptions,
      h,
      renderNodes,
      renderInlineNodes,
      hooks: sharedHooks,
      useAction,
      className,
      id,
      resolve,
      cls: macroClass(config.name, className),
      mutate: (code: string) => executeMutation(code, getValues(), update),
      update,
      getValues,
      wrap: (content: ComponentChildren): VNode<any> => {
        if (className || id)
          return h('span', { id, class: className }, content);
        return h(Fragment, null, content);
      },
    };

    if (config.merged) {
      ctx.merged = useMergedLocals();
      const merged = ctx.merged;
      ctx.evaluate = (expr: string) =>
        evaluate(expr, merged[0], merged[1], merged[2], merged[3]);
    }

    if (config.storeVar) {
      const firstToken =
        props.rawArgs.trim().split(/\s+/)[0]?.replace(/["']/g, '') ?? '';
      const varExpr = firstToken.replace(/["']/g, '').replace(/^\$/, '');
      const segments = varExpr.split('.');
      ctx.varName = varExpr;
      ctx.value = useStoryStore((s) => getByPath(s.variables, segments));
      ctx.getValue = () =>
        getByPath(useStoryStore.getState().variables, segments);
      ctx.setValue = (value: unknown) => {
        useStoryStore.setState((state) => {
          setByPath(
            state.variables as Record<string, unknown>,
            segments,
            value,
          );
        });
      };
    }

    return config.render(props, ctx);
  }

  registerMacro(config.name, Wrapper);

  // Store metadata for tooling API
  const isBlock =
    config.block === true ||
    (config.block !== false && (config.subMacros?.length ?? 0) > 0);
  registerMacroMetadata(config.name, {
    name: config.name,
    block: isBlock,
    subMacros: config.subMacros ?? [],
    storeVar: config.storeVar,
    interpolate: config.interpolate,
    merged: config.merged,
    description: config.description,
    parameters: config.parameters,
    source,
  });

  if (config.subMacros) {
    for (const sub of config.subMacros) registerSubMacro(sub);
  }
  if (isBlock) {
    registerBlockMacro(config.name);
  }
}
