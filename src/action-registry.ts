export type ActionType =
  | 'link'
  | 'button'
  | 'cycle'
  | 'textbox'
  | 'numberbox'
  | 'textarea'
  | 'checkbox'
  | 'radiobutton'
  | 'listbox'
  | 'back'
  | 'forward'
  | 'restart'
  | 'save'
  | 'load'
  | 'dialog';

export interface StoryAction {
  id: string;
  type: ActionType;
  label: string;
  target?: string;
  variable?: string;
  options?: string[];
  value?: unknown;
  disabled?: boolean;
  perform: (value?: unknown) => void;
}

const actions = new Map<string, StoryAction>();
const listeners = new Set<() => void>();
const idCounters = new Map<string, number>();

export function generateActionId(
  type: ActionType,
  key: string,
  authorId?: string,
): string {
  if (authorId) return authorId;

  const base = `${type}:${key}`;
  const count = (idCounters.get(base) ?? 0) + 1;
  idCounters.set(base, count);
  return count === 1 ? base : `${base}:${count}`;
}

export function registerAction(action: StoryAction): () => void {
  actions.set(action.id, action);
  notify();
  return () => {
    actions.delete(action.id);
    notify();
  };
}

export function getActions(): StoryAction[] {
  return Array.from(actions.values());
}

export function getAction(id: string): StoryAction | undefined {
  return actions.get(id);
}

export function clearActions(): void {
  actions.clear();
  notify();
}

export function resetIdCounters(): void {
  idCounters.clear();
}

export function onActionsChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const fn of listeners) {
    fn();
  }
}
