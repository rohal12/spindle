// A stand-in for the play worker that speaks the protocol without Spindle.
import { parentPort, workerData } from 'node:worker_threads';

if (workerData.html === 'hang') {
  // A story whose StoryInit never returns: no ready message.
  for (;;) {}
} else if (workerData.html === 'fail') {
  parentPort.postMessage({ ready: false, error: { message: 'boom' } });
} else {
  const received = [];
  parentPort.on('message', async ({ id, op, args }) => {
    received.push(id);
    if (op === 'step') {
      const [action, arg] = args;
      if (action === 'hang') for (;;) {}
      if (action === 'crash') process.exit(3);
      if (action === 'bad') {
        parentPort.postMessage({ id, ok: false, error: { message: 'bad' } });
        return;
      }
      if (action === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, arg));
        // Counted after the wait: requests that overlapped this one raise it.
        parentPort.postMessage({
          id,
          ok: true,
          result: { order: received.length },
        });
        return;
      }
    }
    parentPort.postMessage({ id, ok: true, result: { echo: args } });
  });
  parentPort.postMessage({ ready: true });
}
