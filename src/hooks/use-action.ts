import { createContext } from 'preact';
import { useContext, useLayoutEffect, useRef } from 'preact/hooks';
import {
  registerAction,
  generateActionId,
  OPTIONAL_ACTION_FIELDS,
  type ActionRegistration,
  type StoryAction,
} from '../action-registry';
import { DialogCloseContext } from '../components/dialog-close-context';

/** The action to register, and what its ID is generated from. */
export interface UseActionOptions extends Omit<StoryAction, 'id'> {
  key: string;
  authorId?: string;
}

/** Associate a macro control's authored attributes with its runtime action. */
export function actionAttributes(
  actionId: string,
  control: { id?: string; cls?: string },
): { id?: string; class?: string; 'data-action'?: string } {
  return {
    id: control.id,
    class: control.cls,
    'data-action': actionId || undefined,
  };
}

/**
 * While true, controls rendered underneath do not register actions or reserve
 * IDs. Used for display-only content mounted off-screen, so it never shows up
 * in `getActions()` or shifts the IDs of the visible passage's controls.
 */
export const ActionsDisabledContext = createContext(false);

export function useAction(opts: UseActionOptions): string {
  const disabled = useContext(ActionsDisabledContext);
  // The dialog the control renders in, for observe() to scope by
  const dialog = useContext(DialogCloseContext);
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
  // Set when the registration below is new in this commit: it is current
  const fresh = useRef(false);
  useLayoutEffect(() => {
    if (disabled) return;
    const own = registerAction(buildAction(), dialog);
    registration.current = own;
    fresh.current = true;
    return () => own.unregister();
  }, [id, disabled, dialog]);

  // When what the action exposes changes (e.g. an input's value), replace it
  // in place: one `actionsChanged` notification, and it keeps its position in
  // getActions(). Unregistering and registering again would notify twice and
  // move it to the end. Its dependencies include the registration's, so it
  // runs in every commit that registers and clears `fresh` there.
  useLayoutEffect(() => {
    if (disabled) return;
    if (fresh.current) {
      fresh.current = false;
      return;
    }
    registration.current?.update(buildAction());
  }, [
    id,
    disabled,
    dialog,
    opts.type,
    opts.label,
    opts.target,
    opts.variable,
    opts.disabled,
    opts.value,
    JSON.stringify(opts.options),
  ]);

  // A control that registers nothing has no ID (the flag may have turned
  // true after it was generated)
  return disabled ? '' : id;
}
