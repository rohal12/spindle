import { defineMacro } from '../../define-macro';
import { addTrigger, removeTrigger } from '../../triggers';
import type { WatchOptions } from '../../triggers';

defineMacro({
  name: 'watch',
  render(props, ctx) {
    const { hooks } = ctx;

    // Parse: condition string + keyword options
    const raw = props.rawArgs.trim();
    // First quoted string is the condition
    const condMatch = raw.match(/^(['"])(.*?)\1\s*/);
    if (!condMatch) return null;

    const condition = condMatch[2]!;
    const rest = raw.slice(condMatch[0].length);

    const options: WatchOptions = {};
    // Parse keyword args: goto "X", dialog "X", run "X", once, name "X", priority N
    const kwRe = /(\w+)\s+(?:"([^"]*?)"|'([^']*?)'|(\d+))|(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = kwRe.exec(rest)) !== null) {
      const key = m[1] ?? m[5];
      const val = m[2] ?? m[3] ?? m[4];
      if (!key) continue;
      switch (key) {
        case 'goto':
          options.goto = val;
          break;
        case 'dialog':
          options.dialog = val;
          break;
        case 'run':
          options.run = val;
          break;
        case 'name':
          options.name = val;
          break;
        case 'priority':
          options.priority = val ? Number(val) : 0;
          break;
        case 'once':
          options.once = true;
          break;
      }
    }

    // Register during render (like {set}) — triggers survive navigation
    // and are cleaned up via resetTriggers() on restart or {unwatch}.
    const registered = hooks.useRef(false);
    if (!registered.current) {
      registered.current = true;
      addTrigger(condition, options);
    }

    return null;
  },
});

defineMacro({
  name: 'unwatch',
  render(props, ctx) {
    const raw = props.rawArgs.trim();
    const name = raw.replace(/^['"]|['"]$/g, '');

    const ran = ctx.hooks.useRef(false);
    if (!ran.current) {
      ran.current = true;
      removeTrigger(name);
    }

    return null;
  },
});
