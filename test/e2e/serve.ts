import { existsSync, readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
};

/**
 * Respond with the file `name` in the directory `root` (an absolute path), or
 * 404 when there is none. A name that leads out of `root`, such as
 * `../../etc/passwd`, finds none.
 */
export function sendFile(
  response: ServerResponse,
  root: string,
  name: string,
): void {
  const path = resolve(root, name);
  if (!path.startsWith(root + sep) || !existsSync(path)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': MIME[extname(path)] ?? 'application/octet-stream',
  });
  response.end(readFileSync(path));
}
