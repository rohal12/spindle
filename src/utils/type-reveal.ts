import { composedParent } from './element-visibility';

/** Remaining revealed characters at this node, across nested typewriters. */
function revealedCharacters(node: Node): number {
  let available = Infinity;
  const element = node.nodeType === 1 ? (node as Element) : node.parentElement;
  for (let at = element; at; at = composedParent(at)) {
    const count = at.getAttribute('data-type-revealed');
    if (count === null) continue;
    let left = Number(count);
    if (!Number.isFinite(left)) continue;
    // The visual clip counts DOM text, including text hidden by other CSS.
    // Shadow content has no measured range until its containing type finishes.
    if (!at.contains(node)) return 0;
    for (let child = node; child !== at; child = child.parentNode!) {
      for (
        let sibling = child.previousSibling;
        sibling;
        sibling = sibling.previousSibling
      ) {
        if (sibling.nodeType === 1 || sibling.nodeType === 3)
          left -= sibling.textContent?.length ?? 0;
      }
    }
    available = Math.min(available, Math.max(0, left));
  }
  return available;
}

/** Only the prefix that every containing typewriter has revealed. */
export function revealedText(node: Text): string {
  return node.data.slice(0, revealedCharacters(node));
}

/** Offer a control once its entire label is revealed, avoiding label spoilers.
 * Controls without DOM text have no measured clip boxes; wait for completion.
 */
export function isFullyRevealed(el: Element): boolean {
  const available = revealedCharacters(el);
  return (
    available === Infinity ||
    (!!el.textContent && available >= el.textContent.length)
  );
}
