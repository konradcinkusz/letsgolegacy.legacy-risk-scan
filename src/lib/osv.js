// Client for the OSV.dev vulnerability database (https://google.github.io/osv.dev/api/).
//
// PRIVACY BOUNDARY. This module is the only code on the page that talks to anything but
// the page's own origin, and toQueries() is the only thing that decides what is sent:
// package coordinates — ecosystem, name, version — and nothing else. No file name, no
// project name, no paths. The e2e suite asserts the exact request body, and the page's
// Content-Security-Policy allows connections to api.osv.dev and to itself only.
//
// Translation at the edge (P11): OSV records are reduced here to the few fields the
// report shows, so a change in OSV's schema breaks this file and its tests, not the UI.

import { compareVersions } from './versions.js';

export const OSV_API = 'https://api.osv.dev/v1';
/** OSV's documented maximum number of queries in one querybatch request. */
export const BATCH_LIMIT = 1000;
const MAX_PAGES = 10;
const DETAIL_CONCURRENCY = 4;
const TIMEOUT_MS = 20_000;

export class OsvError extends Error {
  /** @param {'network'|'timeout'|'http'|'contract'} kind */
  constructor(kind, detail = '') {
    super(`OSV ${kind}${detail ? `: ${detail}` : ''}`);
    this.name = 'OsvError';
    this.kind = kind;
    /** HTTP status for kind 'http'. */
    this.status = kind === 'http' ? Number(detail) : undefined;
  }
}

/** @typedef {{ ecosystem: string, name: string, version: string }} Coordinate */

/**
 * Identity of a coordinate. Names are kept exactly as written: OSV matches NuGet ids
 * case-sensitively (checked against the live API by scripts/smoke-osv.mjs), so
 * "newtonsoft.json" and "Newtonsoft.Json" are different questions to OSV.
 */
export const coordinateKey = (c) => `${c.ecosystem}|${c.name}|${c.version}`;

/** Coordinates without duplicates, first occurrence kept. */
export function uniqueCoordinates(coords) {
  const seen = new Map();
  for (const c of coords) if (!seen.has(coordinateKey(c))) seen.set(coordinateKey(c), c);
  return [...seen.values()];
}

/**
 * The request payload: exactly { package: { ecosystem, name }, version } per coordinate.
 * @param {Coordinate[]} coords
 */
export function toQueries(coords) {
  return coords.map((c) => ({
    package: { ecosystem: String(c.ecosystem), name: String(c.name) },
    version: String(c.version),
  }));
}

async function request(fetchImpl, url, init, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new OsvError('timeout')), TIMEOUT_MS);
  const onAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
    });
    if (!response.ok) throw new OsvError('http', String(response.status));
    try {
      return await response.json();
    } catch {
      throw new OsvError('contract', 'response is not JSON');
    }
  } catch (e) {
    if (signal?.aborted) throw signal.reason ?? e;
    if (e instanceof OsvError) throw e;
    if (controller.signal.aborted) throw new OsvError('timeout');
    throw new OsvError('network', e?.message ?? String(e));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function postBatch(fetchImpl, queries, signal) {
  const body = await request(
    fetchImpl,
    `${OSV_API}/querybatch`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queries }) },
    signal,
  );
  if (!body || !Array.isArray(body.results) || body.results.length !== queries.length) {
    throw new OsvError('contract', 'querybatch results do not match the queries');
  }
  return body.results;
}

/**
 * Asks OSV which vulnerabilities affect each coordinate.
 * @param {Coordinate[]} coords
 * @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal }} [options]
 * @returns {Promise<Map<string, string[]>>} coordinateKey → vulnerability ids
 */
export async function queryVulnerabilities(coords, { fetchImpl = globalThis.fetch, signal } = {}) {
  const unique = uniqueCoordinates(coords);
  const found = new Map(unique.map((c) => [coordinateKey(c), new Set()]));
  for (let start = 0; start < unique.length; start += BATCH_LIMIT) {
    let pending = unique.slice(start, start + BATCH_LIMIT).map((c) => ({ coord: c, pageToken: undefined }));
    for (let page = 0; pending.length && page < MAX_PAGES; page++) {
      const queries = toQueries(pending.map((p) => p.coord)).map((q, i) =>
        pending[i].pageToken ? { ...q, page_token: pending[i].pageToken } : q,
      );
      const results = await postBatch(fetchImpl, queries, signal);
      const next = [];
      results.forEach((result, i) => {
        const ids = found.get(coordinateKey(pending[i].coord));
        for (const v of result?.vulns ?? []) if (v && typeof v.id === 'string') ids.add(v.id);
        if (result?.next_page_token) next.push({ coord: pending[i].coord, pageToken: result.next_page_token });
      });
      pending = next;
    }
  }
  return new Map([...found].map(([k, ids]) => [k, [...ids].sort()]));
}

/**
 * Full records for the given ids. A record that cannot be fetched maps to null — the
 * report then shows the id and its link without a summary, rather than failing.
 * @returns {Promise<Map<string, object|null>>}
 */
export async function fetchVulnerabilityRecords(ids, { fetchImpl = globalThis.fetch, signal } = {}) {
  const out = new Map();
  const queue = [...new Set(ids)];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        out.set(id, await request(fetchImpl, `${OSV_API}/vulns/${encodeURIComponent(id)}`, { method: 'GET' }, signal));
      } catch (e) {
        if (signal?.aborted) throw e;
        out.set(id, null);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, queue.length) }, worker));
  return out;
}

const SEVERITIES = { LOW: 'low', MODERATE: 'moderate', MEDIUM: 'moderate', HIGH: 'high', CRITICAL: 'critical' };
export const SEVERITY_RANK = { critical: 4, high: 3, moderate: 2, low: 1 };

function severityOf(record) {
  const candidates = [
    record?.database_specific?.severity,
    ...(record?.affected ?? []).map((a) => a?.database_specific?.severity ?? a?.ecosystem_specific?.severity),
  ];
  for (const s of candidates) {
    const key = typeof s === 'string' ? s.toUpperCase() : null;
    if (key && SEVERITIES[key]) return SEVERITIES[key];
  }
  return null;
}

/**
 * The report's view of one advisory.
 * @param {string} id
 * @param {object|null} record the OSV record, or null when it could not be fetched
 * @param {Coordinate[]} targets the coordinates it was found for (fixed versions are read
 *   only from the matching "affected" entries)
 */
export function summarizeVulnerability(id, record, targets) {
  const aliases = (record?.aliases ?? []).filter((a) => typeof a === 'string' && a !== id);
  let summary = typeof record?.summary === 'string' ? record.summary.trim() : '';
  if (!summary && typeof record?.details === 'string') {
    const first = record.details.trim().split(/\n\s*\n|\r?\n/)[0] ?? '';
    summary = first.length > 200 ? `${first.slice(0, 199)}…` : first;
  }
  const fixed = new Set();
  for (const affected of record?.affected ?? []) {
    const pkg = affected?.package;
    const target = targets.find(
      (t) => pkg && t.ecosystem === pkg.ecosystem && t.name.toLowerCase() === String(pkg.name).toLowerCase(),
    );
    if (!target) continue;
    for (const range of affected.ranges ?? []) {
      for (const event of range?.events ?? []) {
        if (typeof event?.fixed === 'string' && compareVersions(event.fixed, target.version) > 0) fixed.add(event.fixed);
      }
    }
  }
  return {
    id,
    aliases,
    summary,
    severity: severityOf(record),
    fixed: [...fixed].sort(compareVersions),
    url: `https://osv.dev/vulnerability/${encodeURIComponent(id)}`,
    withdrawn: Boolean(record?.withdrawn),
    detailsAvailable: record != null,
  };
}

/**
 * Merges advisories found under several names (NuGet "jQuery" and npm "jquery") into one
 * list: withdrawn ones dropped, duplicates collapsed by id and by shared alias.
 */
export function mergeAdvisories(advisories) {
  const out = [];
  const seen = new Set();
  for (const a of advisories) {
    if (a.withdrawn) continue;
    const names = [a.id, ...a.aliases];
    if (names.some((n) => seen.has(n))) continue;
    names.forEach((n) => seen.add(n));
    out.push(a);
  }
  return out.sort(
    (x, y) => (SEVERITY_RANK[y.severity] ?? 0) - (SEVERITY_RANK[x.severity] ?? 0) || x.id.localeCompare(y.id),
  );
}
