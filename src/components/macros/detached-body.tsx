import { render } from 'preact';
import { useContext } from 'preact/hooks';
import {
  renderNodes,
  LocalsUpdateContext,
  LocalsValuesContext,
  NobrContext,
  InlineContext,
  WidgetChildrenContext,
} from '../../markup/render';
import type { ASTNode } from '../../markup/ast';
import { liveLocalsView } from '../../utils/live-locals';
import { runWithCommittedMutations } from '../../execute-mutation';
import { RepeatContext } from './Repeat';
import { DialogCloseContext } from '../PassageDialog';

/**
 * Return a function that runs a macro body once, outside the passage tree:
 * it renders `children` into a detached node, so the body's macros ({set},
 * {if}, {goto}, ...) fire their side effects through the normal Preact
 * pipeline, then unmounts it. Used by {button} and {link} on click.
 *
 * A detached render starts with no contexts, so the hook captures the ones
 * the owning macro sees and provides them again: the locals scope (read
 * through a live view, so a local assigned earlier in the body is visible),
 * nobr/inline rendering, the enclosing block widget's {@children}, the
 * enclosing {repeat}'s {stop} and the enclosing dialog's close callback.
 * The body then behaves as if it rendered in place.
 *
 * The body's macros read story state from the store. Run from mutation code
 * (Story.performAction, a click the code dispatches), it runs in program
 * order: the code's writes so far are committed first, so the body sees
 * them, and the code goes on from the state the body leaves (see
 * runWithCommittedMutations).
 */
export function useDetachedBody(): (children: ASTNode[]) => void {
  const updater = useContext(LocalsUpdateContext);
  const nobr = useContext(NobrContext);
  const inline = useContext(InlineContext);
  const widgetChildren = useContext(WidgetChildrenContext);
  const repeat = useContext(RepeatContext);
  const closeDialog = useContext(DialogCloseContext);

  const run = (children: ASTNode[]) => {
    const locals = liveLocalsView(updater.getValues);
    const container = document.createElement('div');
    render(
      <LocalsUpdateContext.Provider value={updater}>
        <LocalsValuesContext.Provider value={locals}>
          <NobrContext.Provider value={nobr}>
            <InlineContext.Provider value={inline}>
              <WidgetChildrenContext.Provider value={widgetChildren}>
                <RepeatContext.Provider value={repeat}>
                  <DialogCloseContext.Provider value={closeDialog}>
                    {renderNodes(children, { nobr, inline, locals })}
                  </DialogCloseContext.Provider>
                </RepeatContext.Provider>
              </WidgetChildrenContext.Provider>
            </InlineContext.Provider>
          </NobrContext.Provider>
        </LocalsValuesContext.Provider>
      </LocalsUpdateContext.Provider>,
      container,
    );
    render(null, container);
  };
  return (children) => runWithCommittedMutations(() => run(children));
}
