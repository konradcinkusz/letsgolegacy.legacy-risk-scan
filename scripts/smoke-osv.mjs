#!/usr/bin/env node
// Smoke test against the REAL OSV API — the one test that proves the page's single
// external dependency still behaves the way the page assumes.
//
//   node scripts/smoke-osv.mjs
//
// Checks, in order:
//   1. CORS: the preflight for a cross-origin POST from the published page's origin is
//      answered with Access-Control-Allow-* headers, and so is the POST itself. Without
//      them a browser refuses the response and the page cannot check vulnerabilities.
//   2. Contract: querybatch finds the advisory the sample file is built to show
//      (Newtonsoft.Json 6.0.4 → GHSA-5crp-9r3c-p9vr), and /v1/vulns returns a record the
//      report can summarise (a fixed version is present).
//
// Exit codes: 0 = pass, OR the API could not be reached at all (a network error is
// reported as a warning and `reachable=false` is written to $GITHUB_OUTPUT so later
// steps can skip); 1 = OSV answered, but not the way the page needs. Only the second is
// a failure of this repository's assumptions, so only the second fails the job.

import https from 'node:https';
import { appendFileSync } from 'node:fs';
import {
  OSV_API,
  OsvError,
  fetchVulnerabilityRecords,
  queryVulnerabilities,
  summarizeVulnerability,
} from '../src/lib/osv.js';

const ORIGIN = process.env.SMOKE_ORIGIN ?? 'https://konradcinkusz.github.io';
const output = (key, value) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
};
const summary = (text) => {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
};

class NetworkError extends Error {}
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
  console.log(`${condition ? 'ok  ' : 'FAIL'} ${message}`);
};

/** Raw HTTPS request, so the Origin header is sent exactly as a browser would send it. */
function raw(method, path, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${OSV_API}${path}`);
    const req = https.request(url, { method, headers, timeout: 20_000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('timeout', () => req.destroy(new NetworkError('timeout')));
    req.on('error', (e) => reject(new NetworkError(e.message)));
    if (body) req.write(body);
    req.end();
  });
}

const allows = (header, value) =>
  typeof header === 'string' && (header.trim() === '*' || header.toLowerCase().split(/\s*,\s*/).includes(value.toLowerCase()));

async function main() {
  // ── 1. CORS ───────────────────────────────────────────────────────────────
  const preflight = await raw('OPTIONS', '/querybatch', {
    Origin: ORIGIN,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  });
  if (preflight.status >= 500) throw new NetworkError(`preflight HTTP ${preflight.status}`);
  const pre = preflight.headers;
  console.log(`preflight: HTTP ${preflight.status}`);
  for (const h of ['access-control-allow-origin', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age']) {
    console.log(`  ${h}: ${pre[h] ?? '(absent)'}`);
  }
  expect(preflight.status >= 200 && preflight.status < 300, `preflight answered 2xx (got ${preflight.status})`);
  expect(pre['access-control-allow-origin'] === '*' || pre['access-control-allow-origin'] === ORIGIN, `preflight allows origin ${ORIGIN}`);
  expect(allows(pre['access-control-allow-methods'], 'POST'), 'preflight allows POST');
  expect(allows(pre['access-control-allow-headers'], 'content-type'), 'preflight allows the Content-Type header');

  const post = await raw(
    'POST',
    '/querybatch',
    { Origin: ORIGIN, 'Content-Type': 'application/json' },
    JSON.stringify({ queries: [{ package: { ecosystem: 'NuGet', name: 'Newtonsoft.Json' }, version: '6.0.4' }] }),
  );
  if (post.status >= 500 || post.status === 429) throw new NetworkError(`querybatch HTTP ${post.status}`);
  console.log(`POST querybatch: HTTP ${post.status}, access-control-allow-origin: ${post.headers['access-control-allow-origin'] ?? '(absent)'}`);
  expect(post.status === 200, `querybatch answered 200 (got ${post.status})`);
  expect(
    post.headers['access-control-allow-origin'] === '*' || post.headers['access-control-allow-origin'] === ORIGIN,
    'querybatch response carries Access-Control-Allow-Origin',
  );

  // ── 2. Contract, through the page's own client code ─────────────────────────
  const coords = [
    { ecosystem: 'NuGet', name: 'Newtonsoft.Json', version: '6.0.4' },
    { ecosystem: 'npm', name: 'jquery', version: '1.10.2' },
    { ecosystem: 'NuGet', name: 'newtonsoft.json', version: '6.0.4' },
    { ecosystem: 'Packagist', name: 'guzzlehttp/guzzle', version: '6.3.0' },
  ];
  const ids = await queryVulnerabilities(coords);
  const list = coords.map((c) => ids.get(`${c.ecosystem}|${c.name.toLowerCase()}|${c.version}`) ?? []);
  coords.forEach((c, i) => console.log(`  ${c.ecosystem} ${c.name} ${c.version}: ${list[i].length} advisories ${list[i].slice(0, 6).join(' ')}`));
  expect(list[0].includes('GHSA-5crp-9r3c-p9vr'), 'NuGet Newtonsoft.Json 6.0.4 → GHSA-5crp-9r3c-p9vr (the sample relies on it)');
  expect(list[1].length > 0, 'npm jquery 1.10.2 has at least one advisory');
  console.log(`info NuGet name matching is ${list[2].length === list[0].length ? 'case-insensitive' : 'case-sensitive'} at OSV`);

  const records = await fetchVulnerabilityRecords(['GHSA-5crp-9r3c-p9vr']);
  const advisory = summarizeVulnerability('GHSA-5crp-9r3c-p9vr', records.get('GHSA-5crp-9r3c-p9vr'), [coords[0]]);
  console.log(`  GHSA-5crp-9r3c-p9vr: severity=${advisory.severity} fixed=${advisory.fixed.join(',')} aliases=${advisory.aliases.join(',')}`);
  expect(advisory.detailsAvailable && advisory.summary.length > 0, '/v1/vulns returns a record with a summary');
  expect(advisory.fixed.length > 0, 'the record names a fixed version for Newtonsoft.Json');
  expect(advisory.severity !== null, 'the record carries a severity the report can show');
}

// Unreachable: no connection, a timeout, or OSV itself failing (5xx) or throttling (429).
// A 4xx is OSV telling us the request is wrong — that is a contract failure, not weather.
const unreachable = (e) =>
  e instanceof NetworkError ||
  (e instanceof OsvError &&
    (e.kind === 'network' || e.kind === 'timeout' || (e.kind === 'http' && (e.status >= 500 || e.status === 429))));

try {
  await main();
} catch (e) {
  if (!unreachable(e)) {
    console.error(`::error::OSV answered, but not the way the page needs: ${e.message}`);
    summary(`### OSV smoke test\n\nFailed: ${e.message}`);
    output('reachable', 'true');
    process.exit(1);
  }
  console.log(`::warning::OSV API not reachable (${e.message}) — smoke test skipped; this is not a failure of the page.`);
  summary(`### OSV smoke test\n\nOSV API not reachable (${e.message}); skipped.`);
  output('reachable', 'false');
  process.exit(0);
}
output('reachable', 'true');
summary(`### OSV smoke test\n\n${failures.length ? `**${failures.length} check(s) failed:**\n\n- ${failures.join('\n- ')}` : 'All checks passed, including CORS for ' + ORIGIN + '.'}`);
if (failures.length) {
  console.error(`::error::OSV answered, but not the way the page needs: ${failures.join('; ')}`);
  process.exit(1);
}
console.log('OSV smoke test passed.');
