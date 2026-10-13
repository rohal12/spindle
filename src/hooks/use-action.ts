import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import {
  registerAction,
  generateActionId,
  OPTIONAL_ACTION_FIELDS,
  type ActionRegistration,
  type StoryAction,
} from '../action-registry';

/** The action to register, and what its ID is generated from. */
export interface UseActionOptions extends Omit<StoryAction, 'id'> {
  key: string;
  authorId?: string;
}

/**
 * While true, controls rendered underneath do not register actions or reserve
 * IDs. Used for display-only content mounted off-screen, so it never shows up
 * in `getActions()` or shifts the IDs of the visible passage's controls.
 */
export const ActionsDisabledContext = createContext(false);

export function useAction(opts: UseActionOptions): string {
  const disabled = useContext(ActionsDisabledContext);
  const idRef = useRef<string>('');
  const performRef = useRef(opts.perform);
  performRef.current = opts.perform;

  // Generate ID only once on first call
  if (!disabled && !idRef.current) {
    idRef.current = generateActionId(opts.type, opts.key, opts.authorId);
  }

  const id = idRef.current;

  const buildAction = (): StoryAction => {
    const action: StoryAction = {
      id,
      type: opts.type,
      label: opts.label,
      perform: (...args) => performRef.current(...args),
    };
    for (const field of OPTIONAL_ACTION_FIELDS) {
      if (opts[field] !== undefined)
        Object.assign(action, { [field]: opts[field] });
    }
    return action;
  };

  // Registered for the component's lifetime. Unregistering removes only this
  // registration, never another control's holding the same ID (#233).
  const registration = useRef<ActionRegistration | null>(null);
  useLayoutEffect(() => {
    if (disabled) return;
    const own = registerAction(buildAction());
    registration.current = own;
    return () => own.unregister();
  }, [id, disabled]);

  // When what the action exposes changes (e.g. an input's value), replace it
  // in place: one `actionsChanged` notification, and it keeps its position in
  // getActions(). Unregistering and registering again would notify twice and
  // move it to the end.
  const registered = useRef(false);
  useLayoutEffect(() => {
    if (disabled) return;
    if (!registered.current) {
      registered.current = true; // the registration above is current
      return;
    }
    registration.current?.update(buildAction());
  }, [
    opts.type,
    opts.label,
    opts.target,
    opts.variable,
    opts.disabled,
    opts.value,
    JSON.stringify(opts.options),
  ]);

  return id;
}
