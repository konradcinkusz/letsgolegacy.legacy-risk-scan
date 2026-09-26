// A stand-in for api.osv.dev and a record of every request the page makes.
//
// The mock answers from the same hand-written OSV records the unit tests use
// (test/fixtures/osv/). Any request to a host other than the page's own origin and
// api.osv.dev is aborted AND recorded, so the privacy test fails on it rather than the
// page silently depending on it.

import { readFileSync } from 'node:fs';

const record = (id) => JSON.parse(readFileSync(new URL(`../test/fixtures/osv/${id}.json`, import.meta.url), 'utf8'));

export const RECORDS = Object.fromEntries(
  ['GHSA-5crp-9r3c-p9vr', 'GHSA-gxr4-xjj5-5px2', 'GHSA-rmxg-73gg-4p98'].map((id) => [id, record(id)]),
);

export const ADVISORIES_BY_COORDINATE = {
  'NuGet|Newtonsoft.Json|6.0.4': ['GHSA-5crp-9r3c-p9vr'],
  'npm|jquery|1.10.2': ['GHSA-gxr4-xjj5-5px2', 'GHSA-rmxg-73gg-4p98'],
};

/** @param {import('@playwright/test').Page} page */
export async function mockOsv(page, { fail = false } = {}) {
  await page.route('https://api.osv.dev/**', async (route) => {
    if (fail) return route.abort('internetdisconnected');
    const url = new URL(route.request().url());
    if (url.pathname === '/v1/querybatch') {
      const { queries } = JSON.parse(route.request().postData() ?? '{}');
      const results = queries.map((q) => {
        const ids = ADVISORIES_BY_COORDINATE[`${q.package.ecosystem}|${q.package.name}|${q.version}`] ?? [];
        return ids.length ? { vulns: ids.map((id) => ({ id, modified: '2025-01-01T00:00:00Z' })) } : {};
      });
      return route.fulfill({ json: { results }, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    const id = decodeURIComponent(url.pathname.replace('/v1/vulns/', ''));
    return RECORDS[id]
      ? route.fulfill({ json: RECORDS[id], headers: { 'Access-Control-Allow-Origin': '*' } })
      : route.fulfill({ status: 404, json: { code: 5, message: 'Bug not found.' } });
  });
}

/** Aborts requests to anywhere but the page's origin and api.osv.dev. */
export async function blockOtherHosts(page) {
  await page.route(
    (url) => !['127.0.0.1', 'localhost', 'api.osv.dev'].includes(url.hostname) && !process.env.BASE_URL?.includes(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
}

/** Every request the page makes from now on: url, method, body, headers. */
export function recordRequests(page) {
  const requests = [];
  page.on('request', (request) =>
    requests.push({ url: request.url(), method: request.method(), body: request.postData(), headers: request.headers() }),
  );
  return requests;
}

export const OSV_DOWN_MESSAGE = 'Nie udało się połączyć z bazą podatności OSV.';
