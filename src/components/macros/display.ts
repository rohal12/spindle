import { h, Fragment, type ComponentChildren, type VNode } from 'preact';

/** The text a value is shown as: nothing for null and undefined. */
export function display(value: unknown): string {
  return value == null ? '' : String(value);
}

/**
 * `content` in a `<span>` carrying `className` and `id`, or in a fragment if
 * it has neither.
 */
export function wrapContent(
  className: string | undefined,
  id: string | undefined,
  content: ComponentChildren,
): VNode<any> {
  if (className || id) return h('span', { id, class: className }, content);
  return h(Fragment, null, content);
}
