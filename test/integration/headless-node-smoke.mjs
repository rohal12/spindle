/**
 * Boots a story through the built headless entry under plain Node module
 * resolution: no vitest/vite transforms, aliases or inlined deps, so the
 * bundle only sees what a consumer's `node_modules` provides.
 *
 * Usage: node test/integration/headless-node-smoke.mjs <headless.js> < story.html
 * Prints a JSON summary of the run on stdout.
 */
import { Window } from 'happy-dom';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const entry = process.argv[2];
if (!entry) {
  console.error('usage: headless-node-smoke.mjs <headless.js> < story.html');
  process.exit(2);
}

let html = '';
process.stdin.setEncoding('utf-8');
for await (const chunk of process.stdin) html += chunk;

// Register a DOM on the global scope, as a happy-dom test environment would:
// add every DOM global Node lacks, and replace Node's own event classes so
// events created by story code can be dispatched on the document. Author
// scripts run through `new Function`, so `window` must be the global object
// for `window.Story` to be visible to them.
const happyWindow = new Window({ url: 'http://localhost/' });
const REPLACE = new Set(['Event', 'EventTarget', 'CustomEvent']);
for (const key of Object.getOwnPropertyNames(happyWindow)) {
  if (key in globalThis && !REPLACE.has(key)) continue;
  globalThis[key] = happyWindow[key];
}
globalThis.window = globalThis;
globalThis.document = happyWindow.document;

const { bootStory } = await import(pathToFileURL(resolve(entry)).href);
const Story = await bootStory({ html });

const summary = { booted: Story.get('booted'), start: Story.passage };
// A store update must re-render through the Preact store hook.
const coin = (await Story.waitForActions()).find((a) => a.type === 'button');
Story.performAction(coin.id);
await Story.waitForActions();
summary.gold = Story.get('gold');
summary.startText = document.querySelector('.passage')?.textContent ?? '';
Story.performAction('link:Hallway');
const actions = await Story.waitForActions();
summary.after = Story.passage;
summary.actions = actions.map((a) => a.id);
summary.text = document.querySelector('.passage')?.textContent ?? '';

process.stdout.write(JSON.stringify(summary));
await happyWindow.happyDOM.abort();
process.exit(0);
