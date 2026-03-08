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
  renderNodes,
  renderInlineNodes,
} from './markup/render';
import { executeMutation } from './execute-mutation';
import { evaluate } from './expression';
import { useStoryStore } from './store';
import { useAction } from './hooks/use-action';
import type { UseActionOptions } from './hooks/use-action';
import { registerMacro, registerSubMacro } from './registry';
import type { MacroProps } from './registry';

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
  ];
  varName?: string;
  value?: unknown;
  setValue?: (value: unknown) => void;
  evaluate?: (expr: string) => unknown;
  wrap: (content: ComponentChildren) => VNode<any>;
  useAction: (opts: UseActionOptions) => string;
  h: typeof h;
  renderNodes: typeof renderNodes;
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
  interpolate?: boolean;
  merged?: boolean;
  storeVar?: boolean;
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

export function defineMacro(config: MacroDefinition): void {
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
    const ctx: MacroContext = {
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
      wrap: undefined as any,
    };

    if (config.merged) {
      ctx.merged = useMergedLocals();
      const merged = ctx.merged;
      ctx.evaluate = (expr: string) =>
        evaluate(expr, merged[0], merged[1], merged[2]);
    }

    if (config.storeVar) {
      const firstToken = props.rawArgs.trim().split(/[\s"']+/)[0] ?? '';
      const varName = firstToken.replace(/["']/g, '').replace(/^\$/, '');
      ctx.varName = varName;
      ctx.value = useStoryStore((s) => s.variables[varName]);
      const setVariable = useStoryStore((s) => s.setVariable);
      ctx.setValue = (value: unknown) => setVariable(varName, value);
    }

    ctx.wrap = (content: ComponentChildren): VNode<any> => {
      if (ctx.className || ctx.id)
        return h('span', { id: ctx.id, class: ctx.className }, content);
      return h(Fragment, null, content);
    };

    return config.render(props, ctx);
  }

  registerMacro(config.name, Wrapper);
  if (config.subMacros) {
    for (const sub of config.subMacros) registerSubMacro(sub);
  }
}
