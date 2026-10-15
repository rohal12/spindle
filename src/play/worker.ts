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
import type { Op, Ready, Reply, Request, WorkerData } from './protocol';

type HeadlessModule = typeof Headless;

const port = parentPort!;
const data = workerData as WorkerData;

/** Make happy-dom's window the global environment Spindle runs in. */
async function installDom(): Promise<void> {
  const { Window } = await loadOptional<typeof HappyDom>(
    'happy-dom',
    'play sessions',
  );
  const window = new Window({ url: 'http://localhost/' });
  const global = globalThis as Record<string, unknown>;
  const source = window as unknown as Record<string, unknown>;
  global.window = window;
  global.document = window.document;
  // Node's own globals (navigator, fetch, ...) stay as they are,
  for (const name of Object.getOwnPropertyNames(window)) {
    if (!(name in globalThis)) global[name] = source[name];
  }
  // except the event classes: happy-dom's dispatchEvent() refuses events
  // made with Node's (`new CustomEvent(':storyready')` at boot).
  for (const name of DOM_EVENT_CLASSES) global[name] = source[name];
  // Node's BroadcastChannel reaches every worker thread in the process, so
  // sessions would hear each other's save-slot notices. Spindle works without
  // one (it falls back when the constructor is missing).
  Object.defineProperty(globalThis, 'BroadcastChannel', {
    configurable: true,
    writable: true,
    value: undefined,
  });
  // Spindle installs `window.Story`; story code ({do}, Story JavaScript)
  // names it as a global, as it can in a browser.
  Object.defineProperty(globalThis, 'Story', {
    configurable: true,
    get: () => source.Story,
  });
}

const DOM_EVENT_CLASSES = ['Event', 'CustomEvent', 'EventTarget'] as const;

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
      story.goto(passage as string);
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
