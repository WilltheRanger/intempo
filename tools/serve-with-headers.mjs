#!/usr/bin/env node
/**
 * Serve a built app **with the headers Cloudflare Pages will actually send**.
 *
 * `npx serve` ignores `public/_headers`, so every local check in this
 * repository — the walk, the a11y audit, every screenshot — runs the app
 * *without* its production Content-Security-Policy. That is the same shape as
 * the `.web.ts` / native split CLAUDE.md already worries about: the surface
 * with the checks is not the surface that ships.
 *
 * It cost a real one. `script-src 'self' 'sha256-…'` refuses a `blob:` script,
 * and the recorder loaded its AudioWorklet from a `blob:` URL — so recording
 * failed on the deployed site with "The recording worklet could not be
 * loaded." and worked perfectly everywhere it was tested.
 *
 *     node tools/serve-with-headers.mjs mobile/dist 4320
 *
 * Only the `/*` block is applied, which is the only one this project uses.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2] ?? 'mobile/dist';
const port = Number(process.argv[3] ?? 4320);

/** The `/*` headers from a Cloudflare `_headers` file. */
function headersFor(dir) {
  const path = join(dir, '_headers');
  if (!existsSync(path)) {
    console.error(`no _headers in ${dir} — serving without them, which is the bug this exists to catch`);
    return {};
  }
  const found = {};
  let inGlobal = false;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (/^\S/.test(line)) {
      inGlobal = line.trim() === '/*';
      continue;
    }
    const match = inGlobal && line.match(/^\s+([A-Za-z-]+):\s*(.+)$/);
    if (match) {
      found[match[1]] = match[2].trim();
    }
  }
  return found;
}

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

const headers = headersFor(root);
console.log(`serving ${root} on :${port} with ${Object.keys(headers).length} header(s) from _headers`);
if (headers['Content-Security-Policy']) {
  console.log(`  CSP: ${headers['Content-Security-Policy']}`);
}

createServer((request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  // `normalize` then strip leading separators: a request for `/../secrets` must
  // not escape the directory being served.
  let file = join(root, normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (existsSync(file) && statSync(file).isDirectory()) {
    file = join(file, 'index.html');
  }
  // Single-page app: an unknown path with **no extension** is a route, and
  // gets `index.html`. One *with* an extension is a missing asset and must
  // 404 — serving the page instead hands the browser HTML where it asked for
  // a script or a font, which breaks the app in a way that looks like a
  // header problem and is not. The first draft of this file did that.
  if (!existsSync(file)) {
    if (extname(file)) {
      response.writeHead(404);
      response.end('not found');
      return;
    }
    file = join(root, 'index.html');
  }
  for (const [name, value] of Object.entries(headers)) {
    response.setHeader(name, value);
  }
  response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  response.writeHead(200);
  createReadStream(file).pipe(response);
}).listen(port);
