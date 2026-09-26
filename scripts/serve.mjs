#!/usr/bin/env node
// A small static server for dist/, used by `npm start` and by the e2e tests.
//
//   node scripts/serve.mjs [--dir dist] [--port 4173] [--base /letsgolegacy.legacy-risk-scan/]
//
// --base mounts the site under a sub-path, the way GitHub Pages serves a project site, so
// a test run locally catches an absolute URL that would break once published.

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'dist' },
    port: { type: 'string', default: process.env.PORT ?? '4173' },
    base: { type: 'string', default: '/' },
  },
});

const root = resolve(values.dir);
const base = `/${values.base.replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csproj': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const send = (status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
    res.end(body);
  };
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    return send(400, 'bad request');
  }
  if (base !== '/' && pathname === base.slice(0, -1)) return send(301, '', { Location: base });
  if (!pathname.startsWith(base)) return send(404, 'not found');
  let file = join(root, pathname.slice(base.length));
  if (file !== root && !file.startsWith(root + sep)) return send(403, 'forbidden');
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    await stat(file);
  } catch {
    return send(404, 'not found');
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(res);
});

server.listen(Number(values.port), '127.0.0.1', () => {
  console.log(`serving ${root} at http://127.0.0.1:${values.port}${base}`);
});
