import { render } from 'preact';
import { useContext, useEffect, useRef } from 'preact/hooks';
import {
  renderNodes,
  LocalsUpdateContext,
  LocalsValuesContext,
  NobrContext,
  InlineContext,
  StructuralContext,
  WidgetChildrenContext,
} from '../../markup/render';
import type { ASTNode } from '../../markup/ast';
import { useRenderOptions } from '../../hooks/use-render-options';
import {
  FrozenStateContext,
  OutgoingContext,
} from '../../hooks/use-story-fields';
import { liveLocalsView } from '../../utils/live-locals';
import { runWithCommittedMutations } from '../../execute-mutation';
import { subscribeStateReplacement } from '../../store';
import { RepeatContext } from './Repeat';
import { DialogCloseContext } from '../PassageDialog';
import { ItemEditContext } from '../../utils/control-edits';

const frozenAlways = () => true;

/**
 * Return a function that runs a macro body once, outside the passage tree:
 * it renders `children` into a detached node, so the body's macros ({set},
 * {if}, {goto}, ...) fire their side effects through the normal Preact
 * pipeline. Used by {button} and {link} on click. The body's state is frozen
 * once it has rendered, so it runs once per click. It stays mounted
 * until the owning macro unmounts (its passage changes, say), so work it
 * starts in an effect, such as the timer of a {timed} or {repeat}, can
 * finish; the passage leaving cancels it, and so does a restart or a load
 * replacing the game, which a control of the story interface outlives
 * (#401).
 *
 * A detached render starts with no contexts, so the hook captures the ones
 * the owning macro sees and provides them again: the locals scope (read
 * through a live view, so a local assigned earlier in the body is visible),
 * nobr/inline rendering, the enclosing block widget's {@children}, the
 * enclosing {repeat}'s {stop} and the enclosing dialog's close callback and whether it runs in a {for} iteration
 * (#411) and the owning passage's departure (#410).
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
  const { nobr, inline, structural } = useRenderOptions();
  const widgetChildren = useContext(WidgetChildrenContext);
  const repeat = useContext(RepeatContext);
  const closeDialog = useContext(DialogCloseContext);
  const inIteration = useContext(ItemEditContext);
  const hasLeft = useContext(OutgoingContext);

  const mounted = useRef<HTMLElement[]>([]);
  useEffect(() => {
    const unsubscribe = subscribeStateReplacement(() => {
      // After the code that replaced the game, which may be running in one
      // of the bodies (`{do}Story.restart(){/do}`), has finished rendering
      const replaced = mounted.current.splice(0);
      queueMicrotask(() => {
        for (const container of replaced) render(null, container);
      });
    });
    return () => {
      unsubscribe();
      for (const container of mounted.current.splice(0)) {
        render(null, container);
      }
    };
  }, []);

  const run = (children: ASTNode[]) => {
    const locals = liveLocalsView(updater.getValues);
    const container = document.createElement('div');
    render(
      <FrozenStateContext.Provider value={frozenAlways}>
        <LocalsUpdateContext.Provider value={updater}>
          <LocalsValuesContext.Provider value={locals}>
            <NobrContext.Provider value={nobr}>
              <InlineContext.Provider value={inline}>
                <StructuralContext.Provider value={structural}>
                  <WidgetChildrenContext.Provider value={widgetChildren}>
                    <RepeatContext.Provider value={repeat}>
                      <DialogCloseContext.Provider value={closeDialog}>
                        <ItemEditContext.Provider value={inIteration}>
                          <OutgoingContext.Provider value={hasLeft}>
                            {renderNodes(children, {
                              nobr,
                              inline,
                              structural,
                              locals,
                            })}
                          </OutgoingContext.Provider>
                        </ItemEditContext.Provider>
                      </DialogCloseContext.Provider>
                    </RepeatContext.Provider>
                  </WidgetChildrenContext.Provider>
                </StructuralContext.Provider>
              </InlineContext.Provider>
            </NobrContext.Provider>
          </LocalsValuesContext.Provider>
        </LocalsUpdateContext.Provider>
      </FrozenStateContext.Provider>,
      container,
    );
    mounted.current.push(container);
  };
  return (children) => runWithCommittedMutations(() => run(children));
}
