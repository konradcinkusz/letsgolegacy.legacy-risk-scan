import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_LIMIT,
  OsvError,
  fetchVulnerabilityRecords,
  mergeAdvisories,
  queryVulnerabilities,
  summarizeVulnerability,
  toQueries,
} from '../src/lib/osv.js';
import { fakeOsv, osvRecord } from './helpers.mjs';

const NEWTONSOFT = { ecosystem: 'NuGet', name: 'Newtonsoft.Json', version: '6.0.4' };

test('the request payload carries package coordinates and nothing else', () => {
  const queries = toQueries([{ ...NEWTONSOFT, path: 'C:\\Firma\\Tajne\\x.dll', project: 'Sklep' }]);
  assert.deepEqual(queries, [{ package: { ecosystem: 'NuGet', name: 'Newtonsoft.Json' }, version: '6.0.4' }]);
});

test('querybatch: one POST, deduplicated coordinates, no credentials, no referrer', async () => {
  const osv = fakeOsv({ byCoordinate: { 'NuGet|Newtonsoft.Json|6.0.4': ['GHSA-5crp-9r3c-p9vr'] } });
  const ids = await queryVulnerabilities([NEWTONSOFT, { ...NEWTONSOFT }, { ecosystem: 'npm', name: 'jquery', version: '1.10.2' }], {
    fetchImpl: osv.fetchImpl,
  });
  assert.equal(osv.calls.length, 1);
  const [{ url, init }] = osv.calls;
  assert.equal(url, 'https://api.osv.dev/v1/querybatch');
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(init.body), {
    queries: [
      { package: { ecosystem: 'NuGet', name: 'Newtonsoft.Json' }, version: '6.0.4' },
      { package: { ecosystem: 'npm', name: 'jquery' }, version: '1.10.2' },
    ],
  });
  assert.deepEqual(ids.get('NuGet|Newtonsoft.Json|6.0.4'), ['GHSA-5crp-9r3c-p9vr']);
  assert.deepEqual(ids.get('npm|jquery|1.10.2'), []);
});

test('names are sent exactly as written: OSV matches NuGet ids case-sensitively', async () => {
  const osv = fakeOsv({ byCoordinate: { 'NuGet|Newtonsoft.Json|6.0.4': ['GHSA-5crp-9r3c-p9vr'] } });
  const lower = { ...NEWTONSOFT, name: 'newtonsoft.json' };
  const ids = await queryVulnerabilities([NEWTONSOFT, lower, { ...NEWTONSOFT }], { fetchImpl: osv.fetchImpl });
  const sent = JSON.parse(osv.calls[0].init.body).queries.map((q) => q.package.name);
  assert.deepEqual(sent, ['Newtonsoft.Json', 'newtonsoft.json'], 'two questions, first spelling first, exact duplicate dropped');
  assert.deepEqual(ids.get('NuGet|Newtonsoft.Json|6.0.4'), ['GHSA-5crp-9r3c-p9vr']);
  assert.deepEqual(ids.get('NuGet|newtonsoft.json|6.0.4'), []);
});

test('querybatch: more coordinates than one batch allows are split', async () => {
  const osv = fakeOsv();
  const coords = Array.from({ length: BATCH_LIMIT + 1 }, (_, i) => ({ ecosystem: 'npm', name: `p${i}`, version: '1.0.0' }));
  await queryVulnerabilities(coords, { fetchImpl: osv.fetchImpl });
  assert.deepEqual(osv.calls.map((c) => JSON.parse(c.init.body).queries.length), [BATCH_LIMIT, 1]);
});

test('querybatch: follows next_page_token for the results that have one', async () => {
  const osv = fakeOsv({
    byCoordinate: { 'npm|jquery|1.10.2': ['GHSA-a'], 'npm|jquery|1.10.2#t1': ['GHSA-b'] },
    pageTokens: { 'npm|jquery|1.10.2': 't1' },
  });
  const ids = await queryVulnerabilities([{ ecosystem: 'npm', name: 'jquery', version: '1.10.2' }], { fetchImpl: osv.fetchImpl });
  assert.equal(osv.calls.length, 2);
  assert.equal(JSON.parse(osv.calls[1].init.body).queries[0].page_token, 't1');
  assert.deepEqual(ids.get('npm|jquery|1.10.2'), ['GHSA-a', 'GHSA-b']);
});

test('failures are classified: network, HTTP status, broken contract', async () => {
  await assert.rejects(queryVulnerabilities([NEWTONSOFT], { fetchImpl: fakeOsv({ fail: 'network' }).fetchImpl }), (e) => e instanceof OsvError && e.kind === 'network');
  await assert.rejects(queryVulnerabilities([NEWTONSOFT], { fetchImpl: fakeOsv({ fail: 'http' }).fetchImpl }), (e) => e instanceof OsvError && e.kind === 'http');
  const wrongShape = async () => Response.json({ results: [] });
  await assert.rejects(queryVulnerabilities([NEWTONSOFT], { fetchImpl: wrongShape }), (e) => e instanceof OsvError && e.kind === 'contract');
  const notJson = async () => new Response('<html>', { status: 200 });
  await assert.rejects(queryVulnerabilities([NEWTONSOFT], { fetchImpl: notJson }), (e) => e instanceof OsvError && e.kind === 'contract');
});

test('a cancelled scan rejects with the abort reason, not an OSV error', async () => {
  const controller = new AbortController();
  const hanging = (url, init) =>
    new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  const pending = queryVulnerabilities([NEWTONSOFT], { fetchImpl: hanging, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, (e) => e.name === 'AbortError');
});

test('records: a missing one maps to null instead of failing the scan', async () => {
  const osv = fakeOsv({ records: { 'GHSA-5crp-9r3c-p9vr': osvRecord('GHSA-5crp-9r3c-p9vr') } });
  const records = await fetchVulnerabilityRecords(['GHSA-5crp-9r3c-p9vr', 'GHSA-missing', 'GHSA-5crp-9r3c-p9vr'], { fetchImpl: osv.fetchImpl });
  assert.equal(records.get('GHSA-5crp-9r3c-p9vr').id, 'GHSA-5crp-9r3c-p9vr');
  assert.equal(records.get('GHSA-missing'), null);
  assert.equal(osv.calls.length, 2, 'each id fetched once');
  assert.ok(osv.calls.every((c) => c.init.method === 'GET'));
});

test('summary: severity, aliases, and only the fixed versions above the one in use', () => {
  const a = summarizeVulnerability('GHSA-5crp-9r3c-p9vr', osvRecord('GHSA-5crp-9r3c-p9vr'), [NEWTONSOFT]);
  assert.equal(a.severity, 'high');
  assert.deepEqual(a.aliases, ['CVE-2024-21907']);
  assert.deepEqual(a.fixed, ['13.0.1']);
  assert.equal(a.url, 'https://osv.dev/vulnerability/GHSA-5crp-9r3c-p9vr');
  assert.match(a.summary, /Newtonsoft\.Json/);
  const newer = summarizeVulnerability('GHSA-5crp-9r3c-p9vr', osvRecord('GHSA-5crp-9r3c-p9vr'), [{ ...NEWTONSOFT, version: '13.0.1' }]);
  assert.deepEqual(newer.fixed, []);
});

test('summary: a record that could not be fetched still yields a linkable advisory', () => {
  const a = summarizeVulnerability('GHSA-x', null, [NEWTONSOFT]);
  assert.equal(a.detailsAvailable, false);
  assert.equal(a.summary, '');
  assert.equal(a.severity, null);
  assert.equal(a.url, 'https://osv.dev/vulnerability/GHSA-x');
});

test('summary: falls back to the first line of details; reads fixed versions for the matching package only', () => {
  const record = {
    id: 'X-1',
    details: 'First line of details.\n\nMore text.',
    affected: [
      { package: { ecosystem: 'npm', name: 'other' }, ranges: [{ events: [{ fixed: '9.9.9' }] }] },
      { package: { ecosystem: 'NuGet', name: 'newtonsoft.json' }, ranges: [{ events: [{ introduced: '0' }, { fixed: '7.0.1' }] }, { events: [{ fixed: '6.0.2' }] }] },
    ],
  };
  const a = summarizeVulnerability('X-1', record, [NEWTONSOFT]);
  assert.equal(a.summary, 'First line of details.');
  assert.deepEqual(a.fixed, ['7.0.1'], 'names match case-insensitively; 6.0.2 is below 6.0.4');
});

test('merge: one entry per advisory across names, withdrawn ones dropped, most severe first', () => {
  const low = { id: 'A', aliases: ['CVE-1'], severity: 'low', withdrawn: false };
  const high = { id: 'B', aliases: [], severity: 'high', withdrawn: false };
  const dupById = { ...low };
  const dupByAlias = { id: 'CVE-1', aliases: [], severity: null, withdrawn: false };
  const withdrawn = { id: 'W', aliases: [], severity: 'critical', withdrawn: true };
  assert.deepEqual(mergeAdvisories([low, high, dupById, dupByAlias, withdrawn]).map((a) => a.id), ['B', 'A']);
});
