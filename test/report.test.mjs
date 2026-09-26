import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../src/lib/manifest.js';
import { buildReport, coordinatesFor } from '../src/lib/report.js';
import { queryVulnerabilities, fetchVulnerabilityRecords } from '../src/lib/osv.js';
import { NOTE_CODES } from '../src/lib/messages.js';
import { fakeOsv, fixture, fixtureJson, osvRecord, sample } from './helpers.mjs';

const eolData = fixtureJson('eol.fixture.json');
const TODAY = '2026-09-26';
const RECORDS = Object.fromEntries(
  ['GHSA-5crp-9r3c-p9vr', 'GHSA-gxr4-xjj5-5px2', 'GHSA-rmxg-73gg-4p98'].map((id) => [id, osvRecord(id)]),
);
const BY_COORDINATE = {
  'NuGet|Newtonsoft.Json|6.0.4': ['GHSA-5crp-9r3c-p9vr'],
  'npm|jquery|1.10.2': ['GHSA-gxr4-xjj5-5px2', 'GHSA-rmxg-73gg-4p98'],
  'NuGet|jQuery|1.10.2': ['GHSA-gxr4-xjj5-5px2'],
};

async function report(text, { infra, fail } = {}) {
  const manifest = parseManifest(text);
  const osv = fakeOsv({ byCoordinate: BY_COORDINATE, records: RECORDS, fail });
  let state;
  try {
    const idsByCoordinate = await queryVulnerabilities(coordinatesFor(manifest), { fetchImpl: osv.fetchImpl });
    const records = await fetchVulnerabilityRecords([...new Set([...idsByCoordinate.values()].flat())], { fetchImpl: osv.fetchImpl });
    state = { state: 'ok', idsByCoordinate, records };
  } catch (e) {
    state = { state: 'error', errorKind: e.kind };
  }
  return buildReport(manifest, { eolData, osv: state, today: TODAY, infra });
}

const row = (r, name) => [...r.platform, ...r.dependencies].find((i) => i.name === name);

test('the sample: .NET Framework 4.5.1 is past its end of life', async () => {
  const r = await report(sample('Sklep.Legacy.csproj'));
  const fx = row(r, '.NET Framework');
  assert.equal(fx.status, 'eol');
  assert.equal(fx.eol.eolDate, '2016-01-12');
  assert.equal(fx.version, '4.5.1');
});

test('the sample: advisories are attached to the packages they affect', async () => {
  const r = await report(sample('Sklep.Legacy.csproj'));
  const json = row(r, 'Newtonsoft.Json');
  assert.equal(json.status, 'vulnerable');
  assert.deepEqual(json.advisories.map((a) => a.id), ['GHSA-5crp-9r3c-p9vr']);
  assert.deepEqual(json.advisories[0].fixed, ['13.0.1']);
  const jquery = row(r, 'jquery');
  assert.equal(jquery.status, 'eol', 'jQuery 1.x is past its end of life, which outranks "vulnerable"');
  assert.equal(jquery.flags.vulnerable, true);
  assert.equal(jquery.advisories.length, 2);
});

test('the sample: what cannot be checked is "unknown", what was checked clean is "ok"', async () => {
  const r = await report(sample('Sklep.Legacy.csproj'));
  assert.equal(row(r, 'Drukarki.Etykiety').status, 'unknown');
  assert.equal(row(r, 'Drukarki.Etykiety').advisoryState, 'not-checkable');
  assert.equal(row(r, 'CrystalDecisions.CrystalReports.Engine').status, 'unknown');
  assert.equal(row(r, 'EntityFramework').status, 'ok');
  assert.equal(row(r, 'modernizr').status, 'ok');
});

test('the sample: summary counts, worst first', async () => {
  const r = await report(sample('Sklep.Legacy.csproj'));
  assert.deepEqual(r.summary, {
    total: 18, // 1 runtime + 17 packages; jquery counts as both "eol" and "vulnerable"
    eol: 2, // .NET Framework 4.5.1, jQuery 1.x
    eolSoon: 0,
    vulnerable: 2, // Newtonsoft.Json, jquery
    ok: 13,
    unknown: 2, // the hand-copied DLL, the GAC component
    advisories: 3,
  });
  assert.equal(r.summary.total, r.platform.length + r.dependencies.length);
  assert.deepEqual(r.dependencies.slice(0, 2).map((i) => i.name), ['jquery', 'Newtonsoft.Json']);
  assert.equal(r.dataDate, '2026-09-01');
  assert.equal(r.osvState, 'ok');
});

test('OSV unreachable: the report still comes back, and says what it could not check', async () => {
  const r = await report(sample('Sklep.Legacy.csproj'), { fail: 'network' });
  assert.equal(r.osvState, 'error');
  assert.equal(row(r, '.NET Framework').status, 'eol', 'end-of-life data does not depend on OSV');
  assert.equal(row(r, 'jquery').status, 'eol');
  const json = row(r, 'Newtonsoft.Json');
  assert.equal(json.status, 'unknown');
  assert.equal(json.advisoryState, 'error');
  assert.ok(json.notes.some((n) => n.code === 'OSV_UNAVAILABLE'));
  assert.equal(r.summary.vulnerable, 0);
});

test('servers chosen in the form become rows with their end-of-life status', async () => {
  const r = await report(sample('Sklep.Legacy.csproj'), { infra: { mssqlserver: '2016', 'windows-server': '2012-r2' } });
  const sql = row(r, 'Microsoft SQL Server');
  assert.equal(sql.status, 'eol');
  assert.equal(sql.kind, 'infrastructure');
  assert.ok(sql.notes.some((n) => n.code === 'EOL_ESU_UNTIL' && n.params.date === '2029-07-10'));
  const ws = row(r, 'Windows Server');
  assert.equal(ws.version, '2012 R2');
  assert.ok(ws.notes.some((n) => n.code === 'EOL_ESU_UNTIL' && n.params.date === '2026-10-13'));
});

test('a NuGet JavaScript package is also checked under its npm name, without duplicates', async () => {
  const r = await report(fixture('manifests/packages.config'));
  const jq = row(r, 'jQuery');
  assert.deepEqual(jq.advisories.map((a) => a.id).sort(), ['GHSA-gxr4-xjj5-5px2', 'GHSA-rmxg-73gg-4p98']);
  assert.ok(jq.notes.some((n) => n.code === 'ALSO_NPM'));
  assert.equal(jq.eol.status, 'eol');
});

test('composer.json: minimum PHP from the constraint, framework cycle from the lowest allowed version', async () => {
  const r = await report(fixture('manifests/composer.json'));
  const php = r.platform.find((i) => i.source.origin === 'require.php');
  assert.equal(php.status, 'eol');
  assert.equal(php.eol.cycle, '7.1');
  assert.ok(php.notes.some((n) => n.code === 'RUNTIME_MINIMUM'));
  const laravel = row(r, 'laravel/framework');
  assert.equal(laravel.eol.cycle, '5.6');
  assert.ok(laravel.notes.some((n) => n.code === 'VERSION_LOWEST' && n.params.version === '5.6.0'));
  assert.equal(row(r, 'firma/wewnetrzny-modul').status, 'unknown');
});

test('SDK-style project: an end of support within 12 months is flagged', async () => {
  const text = fixture('manifests/Sdk.Multi.csproj').replace('net6.0', 'net8.0');
  const r = await report(text);
  const dotnet = row(r, '.NET');
  assert.equal(dotnet.status, 'eol-soon');
  assert.equal(dotnet.eol.eolDate, '2026-11-10');
  assert.equal(r.summary.eolSoon, 1);
  assert.equal(row(r, '.NET Standard').status, 'ok');
  assert.equal(row(r, 'Microsoft.Data.SqlClient').status, 'unknown');
});

test('every note a report can carry has Polish text', async () => {
  const inputs = [
    sample('Sklep.Legacy.csproj'),
    fixture('manifests/Sdk.Multi.csproj'),
    fixture('manifests/packages.config'),
    fixture('manifests/composer.json'),
    fixture('manifests/composer.lock'),
    fixture('manifests/package.json'),
  ];
  for (const text of inputs) {
    for (const fail of [null, 'network']) {
      const r = await report(text, { fail, infra: { mssqlserver: '2016', 'windows-server': '2012-r2' } });
      for (const item of [...r.platform, ...r.dependencies]) {
        for (const note of item.notes) assert.ok(NOTE_CODES.includes(note.code), `no text for ${note.code}`);
      }
    }
  }
});
