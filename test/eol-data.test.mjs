// The committed data/eol.json, as generated from endoflife.date.
//
// These run in CI on every pull request AND in the monthly refresh before its pull
// request is opened — so a change on endoflife.date's side that would break what the page
// relies on (a renamed cycle, a missing product, a malformed date) stops the refresh
// instead of reaching visitors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateDataset } from '../scripts/lib/eol-source.mjs';
import { KEY_DATES, keyDatesTable } from '../scripts/lib/key-dates.mjs';
import { assessVersion } from '../src/lib/eol.js';
import { parseTargetFramework } from '../src/lib/frameworks.js';

const data = JSON.parse(readFileSync(new URL('../data/eol.json', import.meta.url), 'utf8'));
const ON = data.generatedAt;

test('the committed data passes the generator\'s own validation', () => {
  assert.deepEqual(validateDataset(data), []);
  assert.match(data.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(data.source.name, 'endoflife.date');
});

test('every target framework moniker the scanner recognises resolves to a listed release cycle', () => {
  const monikers = [
    'v3.5', 'net40', 'net403', 'net45', 'net451', 'net452', 'net46', 'net461', 'net462', 'net47', 'net471', 'net472',
    'net48', 'net481', 'netcoreapp1.0', 'netcoreapp1.1', 'netcoreapp2.0', 'netcoreapp2.1', 'netcoreapp2.2',
    'netcoreapp3.0', 'netcoreapp3.1', 'net5.0', 'net6.0', 'net7.0', 'net8.0', 'net9.0', 'net10.0',
  ];
  for (const moniker of monikers) {
    const rt = parseTargetFramework(moniker);
    const r = assessVersion(data, rt.product, rt.version, ON);
    assert.ok(r && r.match === 'cycle', `${moniker} → ${rt.product} ${rt.version} has no release cycle`);
  }
});

test('the public sample resolves: .NET Framework 4.5.1 and jQuery 1.x have ended', () => {
  assert.equal(assessVersion(data, 'dotnetfx', '4.5.1', ON).status, 'eol');
  assert.equal(assessVersion(data, 'jquery', '1.10.2', ON).status, 'eol');
});

test('the server lists the form offers are present', () => {
  const labels = (id) => data.products[id].cycles.map((c) => c.label).join(' | ');
  for (const year of ['2012', '2014', '2016', '2017', '2019', '2022']) assert.match(labels('mssqlserver'), new RegExp(year));
  for (const year of ['2012 R2', '2016', '2019', '2022']) assert.match(labels('windows-server'), new RegExp(year));
});

// The refresh prints these dates for review but never asserts them, so a cycle that
// endoflife.date renames would otherwise drop out of the table without any error.
test('the key-dates table has rows for every product it covers', () => {
  const lines = keyDatesTable(data.products).split('\n');
  for (const id of ['dotnetfx', 'dotnet', 'mssqlserver', 'windows-server', 'php']) {
    assert.ok(lines.some((line) => line.startsWith(`| ${id} |`)), `${id}: no row in the key-dates table; was a cycle renamed? See scripts/lib/key-dates.mjs`);
  }
});

test('every cycle named in the key-dates list exists in the committed data', () => {
  for (const [id, names] of KEY_DATES) {
    const have = (data.products[id]?.cycles ?? []).map((c) => c.name);
    for (const name of names) assert.ok(have.includes(name), `${id}: no cycle named "${name}"; the data has ${have.join(', ')}`);
  }
});
