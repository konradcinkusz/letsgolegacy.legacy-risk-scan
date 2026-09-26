// Shared test helpers. Not a test file itself (the runner only picks up *.test.mjs).

import { readFileSync } from 'node:fs';

export const fixture = (path) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8');
export const fixtureJson = (path) => JSON.parse(fixture(path));
export const sample = (path) => readFileSync(new URL(`../samples/${path}`, import.meta.url), 'utf8');

export const osvRecord = (id) => fixtureJson(`osv/${id}.json`);

/**
 * A stand-in for OSV.dev: answers querybatch from `byCoordinate`
 * ("<ecosystem>|<name>|<version>" → ids) and /vulns/<id> from `records`.
 * Every call is recorded so tests can assert exactly what would have been sent.
 */
export function fakeOsv({ byCoordinate = {}, records = {}, fail = null, pageTokens = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (fail === 'network') throw new TypeError('Failed to fetch');
    if (fail === 'http') return new Response('unavailable', { status: 503 });
    const u = new URL(url);
    if (u.pathname === '/v1/querybatch') {
      const { queries } = JSON.parse(init.body);
      const results = queries.map((q) => {
        const key = `${q.package.ecosystem}|${q.package.name}|${q.version}`;
        const page = q.page_token ? `${key}#${q.page_token}` : key;
        const ids = byCoordinate[page] ?? [];
        const result = ids.length ? { vulns: ids.map((id) => ({ id, modified: '2025-01-01T00:00:00Z' })) } : {};
        if (!q.page_token && pageTokens[key]) result.next_page_token = pageTokens[key];
        return result;
      });
      return Response.json({ results });
    }
    const m = /^\/v1\/vulns\/(.+)$/.exec(u.pathname);
    if (m) {
      const record = records[decodeURIComponent(m[1])];
      return record ? Response.json(record) : new Response('{"code":5,"message":"Bug not found."}', { status: 404 });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}
