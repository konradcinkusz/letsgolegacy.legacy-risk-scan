#!/usr/bin/env node
// Refreshes data/eol.json from the public endoflife.date API.
//
//   node scripts/update-eol.mjs                          fetch, validate, write
//   node scripts/update-eol.mjs --keep-date-if-unchanged keep the old date when nothing
//                                                        but the date would change
//   node scripts/update-eol.mjs --out <file> --date YYYY-MM-DD
//
// Runs monthly in CI (.github/workflows/update-eol.yml), which opens a pull request with
// the result. Behind an HTTP proxy, Node's fetch needs NODE_USE_ENV_PROXY=1 (Node ≥ 22.21).
//
// The file is written only when every required product was fetched and the result
// passed validation — a partial or malformed dataset never replaces a complete one.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  API_V0,
  API_V1,
  PRODUCTS,
  SourceShapeError,
  normalizeV0,
  normalizeV1,
  sameContent,
  validateDataset,
} from './lib/eol-source.mjs';
import { keyDatesTable } from './lib/key-dates.mjs';

const { values: args } = parseArgs({
  options: {
    out: { type: 'string', default: fileURLToPath(new URL('../data/eol.json', import.meta.url)) },
    date: { type: 'string' },
    'keep-date-if-unchanged': { type: 'boolean', default: false },
  },
});

const today = args.date ?? new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NotFound extends Error {}

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'legacy-risk-scan data refresh (+https://github.com/konradcinkusz/letsgolegacy.legacy-risk-scan)' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 404) throw new NotFound(url);
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new NotFound(`${url} → HTTP ${response.status}`);
      return await response.json();
    } catch (e) {
      if (e instanceof NotFound || attempt >= 3) throw e;
      console.warn(`  retry ${attempt} for ${url}: ${e.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function fetchProduct(id) {
  const body = await getJson(`${API_V1}/${id}`); // a 404 here means the product does not exist
  try {
    return normalizeV1(id, body);
  } catch (e) {
    if (!(e instanceof SourceShapeError)) throw e;
    console.warn(`::warning::${id}: API v1 response has an unexpected shape (${e.message}); falling back to v0`);
    return normalizeV0(id, await getJson(`${API_V0}/${id}.json`));
  }
}

const products = {};
const unavailable = [];
const failures = [];
for (const { id, label, required } of PRODUCTS) {
  try {
    const { cycles, api } = await fetchProduct(id);
    products[id] = { label, link: `https://endoflife.date/${id}`, api, cycles };
    console.log(`  ${id.padEnd(15)} ${String(cycles.length).padStart(3)} cycles (API ${api})`);
  } catch (e) {
    if (required) failures.push(`${id}: ${e.message}`);
    else {
      unavailable.push(id);
      console.log(`  ${id.padEnd(15)} unavailable (${e.message})`);
    }
  }
}
if (failures.length) {
  console.error(`::error::Required products could not be fetched; data/eol.json left unchanged:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}

const data = {
  schemaVersion: 1,
  generatedAt: today,
  source: {
    name: 'endoflife.date',
    url: 'https://endoflife.date',
    api: `${API_V1}/{product}`,
    licence: 'MIT',
  },
  products,
  unavailable,
};

const problems = validateDataset(data);
if (problems.length) {
  console.error(`::error::Validation failed; data/eol.json left unchanged:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

let previous = null;
try {
  previous = JSON.parse(await readFile(args.out, 'utf8'));
} catch {
  // first run, or an unreadable file that is about to be replaced
}
const unchanged = sameContent(previous, data);
if (unchanged && args['keep-date-if-unchanged']) data.generatedAt = previous.generatedAt;
await mkdir(dirname(args.out), { recursive: true });
await writeFile(args.out, `${JSON.stringify(data, null, 2)}\n`);

// Dates worth a human glance in the pull request. Printed, never asserted — endoflife.date
// is the authority; which cycles are listed is in scripts/lib/key-dates.mjs.
const table = keyDatesTable(products);
console.log(`\nwrote ${args.out} (${unchanged ? 'content unchanged' : 'content changed'}, date ${data.generatedAt})\n\n${table}`);
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### End-of-life data (${data.generatedAt}, ${unchanged ? 'unchanged' : 'changed'})\n\n${table}\n\nUnavailable optional products: ${unavailable.join(', ') || 'none'}\n`,
  );
}
