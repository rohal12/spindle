import { defineMacro } from '../../define-macro';
import { addMacroTrigger, removeTrigger } from '../../triggers';
import type { WatchOptions } from '../../triggers';
import { isWhitespace, readQuoted } from './arg-utils';

const WORD_RE = /\w+/y;
const DIGITS_RE = /\d+/y;

/** Match the sticky regex `re` at `pos`, returning the matched text. */
function matchAt(re: RegExp, src: string, pos: number): string | null {
  re.lastIndex = pos;
  return re.exec(src)?.[0] ?? null;
}

/**
 * Parse `{watch "condition" keyword value …}`: a quoted condition followed
 * by keyword options (`goto "X"`, `dialog "X"`, `run "X"`, `name "X"`,
 * `priority N`, `once`). Quoted strings accept `\"`, `\'` and `\\` escapes.
 * Returns `null` when the arguments do not start with a quoted condition.
 */
export function parseWatchArgs(
  rawArgs: string,
): { condition: string; options: WatchOptions } | null {
  const raw = rawArgs.trim();
  const cond = readQuoted(raw, 0);
  if (!cond) return null;

  const options: WatchOptions = {};
  let i = cond.end;
  while (i < raw.length) {
    const key = matchAt(WORD_RE, raw, i);
    if (!key) {
      // Skip whitespace and stray characters, or a stray quoted string.
      i = readQuoted(raw, i)?.end ?? i + 1;
      continue;
    }
    i += key.length;

    // A value is a quoted string or a digit run, after whitespace.
    let val: string | undefined;
    let j = i;
    while (j < raw.length && isWhitespace(raw[j]!)) j++;
    if (j > i) {
      const quoted = readQuoted(raw, j);
      const digits = quoted ? null : matchAt(DIGITS_RE, raw, j);
      if (quoted) {
        val = quoted.value;
        i = quoted.end;
      } else if (digits) {
        val = digits;
        i = j + digits.length;
      }
    }

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

  return { condition: cond.value, options };
}

/**
 * Parse the watcher name of `{unwatch "name"}`: a quoted string, with the
 * same escapes as `{watch}`, or a bare name.
 */
export function parseUnwatchName(rawArgs: string): string {
  const raw = rawArgs.trim();
  const quoted = readQuoted(raw, 0);
  if (quoted && quoted.end === raw.length) return quoted.value;
  return raw.replace(/^['"]|['"]$/g, '');
}

defineMacro({
  name: 'watch',
  render(props, ctx) {
    const { hooks } = ctx;

    const parsed = parseWatchArgs(props.rawArgs);
    if (!parsed) return null;
    const { condition, options } = parsed;

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
  render(props, ctx) {
    const name = parseUnwatchName(props.rawArgs);

    const ran = ctx.hooks.useRef(false);
    if (!ran.current) {
      ran.current = true;
      removeTrigger(name);
    }

    return null;
  },
});
