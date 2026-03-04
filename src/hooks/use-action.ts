import { useLayoutEffect, useRef } from 'preact/hooks';
import {
  registerAction,
  generateActionId,
  type ActionType,
  type StoryAction,
} from '../action-registry';

export interface UseActionOptions {
  type: ActionType;
  key: string;
  authorId?: string;
  label: string;
  target?: string;
  variable?: string;
  options?: string[];
  value?: unknown;
  disabled?: boolean;
  perform: (value?: unknown) => void;
}

export function useAction(opts: UseActionOptions): string {
  const idRef = useRef<string>('');

  // Generate ID only once on first call
  if (!idRef.current) {
    idRef.current = generateActionId(opts.type, opts.key, opts.authorId);
  }

  const id = idRef.current;

  useLayoutEffect(() => {
    const action: StoryAction = {
      id,
      type: opts.type,
      label: opts.label,
      perform: opts.perform,
    };
    if (opts.target !== undefined) action.target = opts.target;
    if (opts.variable !== undefined) action.variable = opts.variable;
    if (opts.options !== undefined) action.options = opts.options;
    if (opts.value !== undefined) action.value = opts.value;
    if (opts.disabled !== undefined) action.disabled = opts.disabled;

    return registerAction(action);
  });

  return id;
}
