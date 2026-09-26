// One scan: text in, report (or a coded error) out.
//
// Degradation, not failure (P8): if OSV cannot be reached, the report is still produced
// from the end-of-life data, every package whose vulnerabilities could not be checked is
// marked as such, and the page offers a retry. Only input the scan cannot read at all
// ends in an error, and every error — including a bug — becomes a message, never a crash.

import { ScanError } from './errors.js';
import { parseManifest } from './manifest.js';
import { buildReport, coordinatesFor } from './report.js';
import { queryVulnerabilities, fetchVulnerabilityRecords, OsvError } from './osv.js';
import { todayIso } from './eol.js';

/**
 * @param {string} text
 * @param {{
 *   eolData: object,
 *   fetchImpl?: typeof fetch,
 *   today?: string,
 *   infra?: Record<string, string>,
 *   signal?: AbortSignal,
 *   onProgress?: (stage: 'parsed'|'osv', detail: object) => void,
 * }} options
 * @returns {Promise<{ ok: true, report: object, manifest: object, osv: object }
 *                  | { ok: false, error: { code: string, params: object } }>}
 *   manifest and osv are returned so the report can be rebuilt (rebuildReport) when only
 *   the form's server choices change, without asking OSV again.
 */
export async function runScan(text, { eolData, fetchImpl = globalThis.fetch, today = todayIso(), infra = {}, signal, onProgress } = {}) {
  let manifest;
  try {
    manifest = parseManifest(text);
  } catch (e) {
    if (e instanceof ScanError) return { ok: false, error: { code: e.code, params: e.params } };
    return { ok: false, error: { code: 'UNEXPECTED', params: {} } };
  }

  try {
    const coords = coordinatesFor(manifest);
    onProgress?.('parsed', { packages: manifest.packages.length, queries: coords.length });
    let osv = { state: 'skipped' };
    if (coords.length) {
      onProgress?.('osv', { queries: coords.length });
      try {
        const idsByCoordinate = await queryVulnerabilities(coords, { fetchImpl, signal });
        const ids = [...new Set([...idsByCoordinate.values()].flat())];
        const records = await fetchVulnerabilityRecords(ids, { fetchImpl, signal });
        osv = { state: 'ok', idsByCoordinate, records };
      } catch (e) {
        if (!(e instanceof OsvError)) throw e;
        osv = { state: 'error', errorKind: e.kind };
      }
    }
    return { ok: true, report: buildReport(manifest, { eolData, osv, today, infra }), manifest, osv };
  } catch (e) {
    if (signal?.aborted) throw e;
    // A bug, not bad input. Logged locally for whoever opens the console; nothing is sent.
    globalThis.console?.error?.('Legacy Risk Scan: unexpected error', e);
    return { ok: false, error: { code: 'UNEXPECTED', params: {} } };
  }
}

/** The same scan's report with different server choices: no parsing, no network. */
export function rebuildReport(previous, { eolData, today = todayIso(), infra = {} }) {
  return buildReport(previous.manifest, { eolData, osv: previous.osv, today, infra });
}
