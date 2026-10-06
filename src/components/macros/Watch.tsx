import { defineMacro } from '../../define-macro';
import { addMacroTrigger, removeTrigger } from '../../triggers';

defineMacro({
  name: 'watch',
  // {watch "condition" goto "X" dialog "X" run "X" name "X" priority N once}
  parameters: [
    { name: 'condition', type: 'string', required: true },
    {
      name: 'options',
      type: 'options',
      parameters: [
        { name: 'goto', type: 'string' },
        { name: 'dialog', type: 'string' },
        { name: 'run', type: 'string' },
        { name: 'name', type: 'string' },
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
    const registered = hooks.useRef(false);
    if (!registered.current) {
      registered.current = true;
      addMacroTrigger(condition, options);
    }

    return null;
  },
});

defineMacro({
  name: 'unwatch',
  parameters: [{ name: 'name', type: 'text', required: true }],
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
