/**
 * The worker thread of a play session: boots the story on happy-dom and
 * answers the session handle's calls (see `protocol.ts`). Built to
 * `dist/pkg/play-worker.js`.
 */
import { parentPort, workerData } from 'node:worker_threads';
import type * as HappyDom from 'happy-dom';
import type * as Headless from '../headless';
import { errorMessage } from '../utils/error-message';
import { loadOptional } from './optional';
import { installWindowEvents } from './window-events';
import type { Op, Ready, Reply, Request, WorkerData } from './protocol';

type HeadlessModule = typeof Headless;

// Story output (`console.log` in a {do}) goes to stderr: a host speaking a
// protocol on stdout (an MCP server over stdio) must not receive it.
const stderr = process.stderr;
Object.defineProperty(process, 'stdout', {
  configurable: true,
  get: () => stderr,
});

const port = parentPort!;
const data = workerData as WorkerData;

/** Install happy-dom's DOM in the global environment Spindle runs in. */
async function installDom(): Promise<void> {
  const { Window } = await loadOptional<typeof HappyDom>(
    'happy-dom',
    'play sessions',
  );
  const window = new Window({ url: 'http://localhost/' });
  installWindowEvents(window);
  const global = globalThis as Record<string, unknown>;
  const source = window as unknown as Record<string, unknown>;
  global.document = window.document;
  // Node's own globals (fetch, URL, ...) stay as they are,
  for (const name of Object.getOwnPropertyNames(window)) {
    if (!(name in globalThis)) {
      // happy-dom binds its accessors to the DOM window. Keep them live:
      // copying values disconnects onresize setters and snapshots dimensions.
      Object.defineProperty(
        globalThis,
        name,
        Object.getOwnPropertyDescriptor(window, name)!,
      );
    }
  }
  // except those the story must get from happy-dom.
  for (const name of HAPPY_DOM_GLOBALS) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: source[name],
    });
  }
  // Story JavaScript and expressions run through Function in this realm.
  // Use that realm's global object for browser aliases too, so assignments,
  // property descriptors and deletions on window have browser semantics.
  for (const name of ['window', 'self', 'parent', 'top', 'frames']) {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: globalThis,
    });
  }
  // DOM event callbacks and document.defaultView still use the backing
  // window. Preserve their access to the API now installed on globalThis.
  Object.defineProperty(window, 'Story', {
    configurable: true,
    get: () => global.Story,
    set: (value: unknown) => {
      global.Story = value;
    },
  });
  installIdleCallbacks();
  // Node's BroadcastChannel reaches every worker thread in the process, so
  // sessions would hear each other's save-slot notices. Spindle works without
  // one (it falls back when the constructor is missing).
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

/** happy-dom has no idle scheduler; yield to a timer with a 50 ms budget. */
function installIdleCallbacks(): void {
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let nextHandle = 0;
  globalThis.requestIdleCallback = (callback, options) => {
    const handle = ++nextHandle;
    const requested = performance.now();
    timers.set(
      handle,
      setTimeout(() => {
        timers.delete(handle);
        const started = performance.now();
        const didTimeout =
          options?.timeout !== undefined &&
          started - requested >= options.timeout;
        callback({
          didTimeout,
          timeRemaining: () =>
            didTimeout ? 0 : Math.max(0, 50 - (performance.now() - started)),
        });
      }, 1),
    );
    return handle;
  };
  globalThis.cancelIdleCallback = (handle) => {
    clearTimeout(timers.get(handle));
    timers.delete(handle);
  };
}

/**
 * Globals happy-dom's window replaces even where Node has its own:
 * - the event classes: happy-dom's dispatchEvent() refuses events made with
 *   Node's (`new CustomEvent(':storyready')` at boot);
 * - the storages: Node 25+ has a `localStorage` that is undefined without
 *   `--localstorage-file`, and Node's would be shared by every session;
 * - `navigator`: Node's `navigator.locks` is shared by every worker in the
 *   process.
 */
const HAPPY_DOM_GLOBALS = [
  'Event',
  'CustomEvent',
  'EventTarget',
  'localStorage',
  'sessionStorage',
  'navigator',
] as const;

/**
 * A value as the reply will carry it (structured clone keeps Map, Set, Date
 * and cycles), or a marker when it cannot be cloned (a function, a Map
 * holding one).
 */
function encode(value: unknown): unknown {
  try {
    return structuredClone(value);
  } catch (err) {
    return `[unserializable: ${errorMessage(err)}]`;
  }
}

function encodeAll(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(values)) out[name] = encode(value);
  return out;
}

async function start(): Promise<void> {
  await installDom();
  const headless = (await import(
    /* @vite-ignore */ data.headlessUrl
  )) as HeadlessModule;
  const story = await headless.bootStory({
    html: data.html,
    transitions: data.transitions,
  });
  const transcript = headless.createTranscript(story, data.transcript);

  const ops: Record<Op, (args: unknown[]) => unknown> = {
    observe: () => story.observe(),
    step: ([id, value]) => transcript.step(id as string, value),
    goto: async ([passage]) => {
      const name = passage as string;
      // Story.goto() reports a passage it won't go to and returns.
      const refused = headless.gotoError(name);
      if (refused !== null) throw new Error(`spindle: ${refused}`);
      story.goto(name);
      await story.waitForActions();
      return story.observe();
    },
    get: ([names]) => {
      if (names === undefined) return encodeAll(headless.storyVariables());
      const values: Record<string, unknown> = {};
      for (const name of names as string[]) {
        const key = name.replace(/^\$/, '');
        values[key] = story.get(key);
      }
      return encodeAll(values);
    },
    set: async ([values]) => {
      // Story.set() takes names with or without the `$`.
      story.set(values as Record<string, unknown>);
      await story.waitForActions();
    },
    transcript: () => [...transcript.entries],
  };

  port.on('message', async ({ id, op, args }: Request) => {
    let reply: Reply;
    try {
      reply = { id, ok: true, result: await ops[op](args) };
    } catch (err) {
      reply = { id, ok: false, error: { message: errorMessage(err) } };
    }
    try {
      port.postMessage(reply);
    } catch (err) {
      // The result could not be cloned: report why instead of no reply.
      port.postMessage({
        id,
        ok: false,
        error: { message: errorMessage(err) },
      } satisfies Reply);
    }
  });
  port.postMessage({ ready: true } satisfies Ready);
}

start().catch((err: unknown) => {
  port.postMessage({
    ready: false,
    error: { message: errorMessage(err) },
  } satisfies Ready);
  process.exit(1);
});
