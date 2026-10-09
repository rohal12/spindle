import { defineMacro } from '../../define-macro';
import { FrozenStateContext } from '../../hooks/use-story-fields';
import { useStoryStore } from '../../store';
import { InterfaceContext } from '../../markup/render';
import {
  addMacroTrigger,
  declareInterfaceWatch,
  removeTrigger,
  subscribeTriggerResets,
  triggerResets,
} from '../../triggers';

defineMacro({
  name: 'watch',
  // {watch "condition" goto "X" dialog "X" run "X" name "X" priority N once}
  parameters: [
    {
      name: 'condition',
      type: 'string',
      holds: 'expression',
      required: true,
    },
    {
      name: 'options',
      type: 'options',
      parameters: [
        { name: 'goto', type: 'string', holds: 'passage' },
        { name: 'dialog', type: 'string', holds: 'passage' },
        { name: 'run', type: 'string', holds: 'statements' },
        { name: 'name', type: 'string', holds: 'text' },
        { name: 'priority', type: 'number' },
        { name: 'once', type: 'flag' },
      ],
    },
  ],
  render(_props, ctx) {
    const { hooks } = ctx;

    // Without a quoted condition there is nothing to watch.
    const { condition, options } = ctx.args;
    if (condition === undefined) return null;

    // Register during render (like {set}) — triggers survive navigation
    // and are cleaned up via resetTriggers() on restart or {unwatch}.
    // Remounts (revisits, re-rendered branches) keep the registered watcher.
    // A {watch} still mounted when a restart forgets the watchers (in the
    // story interface) registers it again for the new game (#402); one in a
    // passage on its way out or a finished click body does not.
    const frozen = hooks.useContext(FrozenStateContext);
    const [, rerender] = hooks.useState(0);
    hooks.useEffect(
      () => subscribeTriggerResets(() => rerender((n) => n + 1)),
      [],
    );
    // The interface's watchers are re-registered by a load of a save made
    // before the interface mounted (#419)
    const inInterface = hooks.useContext(InterfaceContext);
    const declaredKey = JSON.stringify([condition, options]);
    hooks.useLayoutEffect(
      () =>
        inInterface ? declareInterfaceWatch(condition, options) : undefined,
      [inInterface, declaredKey],
    );
    const registered = hooks.useRef<number | null>(null);
    if (
      registered.current === null ||
      (registered.current !== triggerResets() &&
        !frozen?.(useStoryStore.getState()))
    ) {
      registered.current = triggerResets();
      addMacroTrigger(condition, options);
    }

    return null;
  },
});

defineMacro({
  name: 'unwatch',
  parameters: [{ name: 'name', type: 'text', holds: 'text', required: true }],
  render(_props, ctx) {
    const name = ctx.args.name ?? '';

    const ran = ctx.hooks.useRef(false);
    if (!ran.current) {
      ran.current = true;
      removeTrigger(name);
    }

    return null;
  },
});
