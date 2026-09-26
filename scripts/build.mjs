#!/usr/bin/env node
// Assembles the static site into dist/: the page (src/), the end-of-life data and the
// sample. No bundling or transpiling — the page is plain ES modules served as written, so
// what is reviewed in src/ is exactly what a visitor runs.
//
// dist/build.json records the commit being deployed; the post-deploy check waits until the
// live site serves it before testing, so it never passes against a stale deployment.

import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = `${root}dist`;

await rm(dist, { recursive: true, force: true });
await mkdir(`${dist}/data`, { recursive: true });
await mkdir(`${dist}/samples`, { recursive: true });
await cp(`${root}src`, dist, { recursive: true });
await cp(`${root}data/eol.json`, `${dist}/data/eol.json`);
await cp(`${root}samples/Sklep.Legacy.csproj`, `${dist}/samples/Sklep.Legacy.csproj`);

let commit = process.env.GITHUB_SHA ?? null;
if (!commit) {
  try {
    commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    commit = 'unknown';
  }
}
await writeFile(`${dist}/build.json`, `${JSON.stringify({ commit, builtAt: new Date().toISOString() }, null, 2)}\n`);
console.log(`built dist/ (commit ${commit.slice(0, 12)})`);
