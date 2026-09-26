import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScan } from '../src/lib/scan.js';
import { fakeOsv, fixtureJson, osvRecord, sample } from './helpers.mjs';

const eolData = fixtureJson('eol.fixture.json');

test('the sample scans end to end: parse, query OSV, build the report', async () => {
  const osv = fakeOsv({
    byCoordinate: { 'NuGet|Newtonsoft.Json|6.0.4': ['GHSA-5crp-9r3c-p9vr'] },
    records: { 'GHSA-5crp-9r3c-p9vr': osvRecord('GHSA-5crp-9r3c-p9vr') },
  });
  const stages = [];
  const result = await runScan(sample('Sklep.Legacy.csproj'), {
    eolData,
    fetchImpl: osv.fetchImpl,
    today: '2026-09-26',
    onProgress: (stage, detail) => stages.push([stage, detail.queries]),
  });
  assert.equal(result.ok, true);
  assert.ok(result.report.summary.eol >= 1);
  assert.ok(result.report.summary.vulnerable >= 1);
  assert.deepEqual(stages.map(([s]) => s), ['parsed', 'osv']);
  // Every outbound call went to OSV, and the only POST carried coordinates only.
  assert.ok(osv.calls.every((c) => c.url.startsWith('https://api.osv.dev/v1/')));
  const posted = osv.calls.filter((c) => c.init.method === 'POST').flatMap((c) => JSON.parse(c.init.body).queries);
  for (const q of posted) {
    assert.deepEqual(Object.keys(q).sort(), ['package', 'version']);
    assert.deepEqual(Object.keys(q.package).sort(), ['ecosystem', 'name']);
  }
  assert.ok(!osv.calls.some((c) => String(c.init.body ?? '').includes('Sklep')), 'the project name never leaves');
});

test('unreadable input comes back as a coded error, not an exception', async () => {
  const result = await runScan('<Project><ItemGroup></Project>', { eolData, fetchImpl: fakeOsv().fetchImpl });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'XML_MALFORMED');
});

test('a file with nothing to check produces an empty report without calling OSV', async () => {
  const osv = fakeOsv();
  const result = await runScan('<packages></packages>', { eolData, fetchImpl: osv.fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.report.summary.total, 0);
  assert.equal(result.report.osvState, 'skipped');
  assert.equal(osv.calls.length, 0);
});

test('OSV down: still a report, marked as incomplete', async () => {
  const result = await runScan(sample('Sklep.Legacy.csproj'), { eolData, fetchImpl: fakeOsv({ fail: 'http' }).fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.report.osvState, 'error');
  assert.equal(result.report.osvErrorKind, 'http');
});

test('a bug becomes an "unexpected" message rather than a crash', async (t) => {
  t.mock.method(console, 'error', () => {});
  const broken = {
    get products() {
      throw new Error('boom');
    },
  };
  const result = await runScan(sample('Sklep.Legacy.csproj'), { eolData: broken, fetchImpl: fakeOsv().fetchImpl });
  assert.deepEqual(result, { ok: false, error: { code: 'UNEXPECTED', params: {} } });
});

test('a superseded scan is cancelled, not reported', async () => {
  const controller = new AbortController();
  const hanging = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const pending = runScan(sample('Sklep.Legacy.csproj'), { eolData, fetchImpl: hanging, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e.name === 'AbortError');
});
