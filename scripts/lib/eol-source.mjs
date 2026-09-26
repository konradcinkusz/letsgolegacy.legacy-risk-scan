// endoflife.date → data/eol.json: the translation layer (P11 — anti-corruption at the
// edge). Everything the page knows about support dates passes through normalize*() here,
// so a change in the API's shape fails this module's tests and the update job, and never
// reaches a visitor as a silently wrong date.
//
// API v1 (https://endoflife.date/docs/api/v1/) is primary. The older v0 endpoint is a
// fallback used only when a v1 response does not match the expected shape; the output
// records which one was used for every product.

import { findCycle } from '../../src/lib/eol.js';

export const API_V1 = 'https://endoflife.date/api/v1/products';
export const API_V0 = 'https://endoflife.date/api';

/**
 * Products the page uses. "required" products must be present or the update fails
 * (keeping the previous, complete file); optional ones are recorded as unavailable.
 */
export const PRODUCTS = [
  { id: 'dotnetfx', label: '.NET Framework', required: true },
  { id: 'dotnet', label: '.NET', required: true },
  { id: 'php', label: 'PHP', required: true },
  { id: 'nodejs', label: 'Node.js', required: true },
  { id: 'angular', label: 'Angular', required: true },
  { id: 'angularjs', label: 'AngularJS', required: true },
  { id: 'laravel', label: 'Laravel', required: true },
  { id: 'symfony', label: 'Symfony', required: true },
  { id: 'mssqlserver', label: 'Microsoft SQL Server', required: true },
  { id: 'windows-server', label: 'Windows Server', required: true },
  { id: 'jquery', label: 'jQuery', required: false },
  { id: 'bootstrap', label: 'Bootstrap', required: false },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export class SourceShapeError extends Error {
  constructor(product, detail) {
    super(`${product}: unexpected API response shape (${detail})`);
    this.name = 'SourceShapeError';
  }
}

const isoOrNull = (v) => (typeof v === 'string' && ISO.test(v) ? v : null);

/** A date, or — when there is none — the boolean flag; null when neither is present. */
function dateOrFlag(date, flag) {
  if (typeof date === 'string' && ISO.test(date)) return date;
  if (typeof flag === 'boolean') return flag;
  return null;
}

/** v1: { result: { label, releases: [{ name, label, releaseDate, isLts, isEol, eolFrom, … }] } } */
export function normalizeV1(productId, body) {
  const releases = body?.result?.releases;
  if (!Array.isArray(releases) || releases.length === 0) throw new SourceShapeError(productId, 'result.releases missing or empty');
  const cycles = releases.map((r, i) => {
    if (typeof r?.name !== 'string' || !r.name) throw new SourceShapeError(productId, `releases[${i}].name`);
    if (typeof r.isEol !== 'boolean') throw new SourceShapeError(productId, `releases[${i}].isEol`);
    const hasEoas = 'isEoas' in r || 'eoasFrom' in r;
    const hasEoes = 'isEoes' in r || 'eoesFrom' in r;
    return {
      name: r.name,
      label: typeof r.label === 'string' && r.label ? r.label : r.name,
      releaseDate: isoOrNull(r.releaseDate),
      lts: r.isLts === true,
      eoas: hasEoas ? dateOrFlag(r.eoasFrom, r.isEoas) : null,
      eol: dateOrFlag(r.eolFrom, r.isEol),
      eoes: hasEoes ? dateOrFlag(r.eoesFrom, r.isEoes) : null,
      latest: typeof r.latest?.name === 'string' ? r.latest.name : null,
    };
  });
  return { apiLabel: typeof body.result.label === 'string' ? body.result.label : null, cycles, api: 'v1' };
}

/**
 * v0: [{ cycle, releaseDate, eol, support, extendedSupport, lts, latest }]. Its flags are
 * phrased the other way round for support ("support: true" = still supported), so they
 * are converted to v1's "has it ended?" meaning here.
 */
export function normalizeV0(productId, body) {
  if (!Array.isArray(body) || body.length === 0) throw new SourceShapeError(productId, 'v0 array missing or empty');
  const ended = (value) => (typeof value === 'string' ? isoOrNull(value) : typeof value === 'boolean' ? !value : null);
  const cycles = body.map((c, i) => {
    if (c?.cycle === undefined || c.cycle === null || c.cycle === '') throw new SourceShapeError(productId, `[${i}].cycle`);
    const eol = typeof c.eol === 'string' ? isoOrNull(c.eol) : typeof c.eol === 'boolean' ? c.eol : null;
    if (eol === null) throw new SourceShapeError(productId, `[${i}].eol`);
    return {
      name: String(c.cycle),
      label: String(c.cycle),
      releaseDate: isoOrNull(c.releaseDate),
      lts: c.lts === true || typeof c.lts === 'string',
      eoas: 'support' in c ? ended(c.support) : null,
      eol,
      eoes: 'extendedSupport' in c ? (typeof c.extendedSupport === 'string' ? isoOrNull(c.extendedSupport) : null) : null,
      latest: c.latest != null ? String(c.latest) : null,
    };
  });
  return { apiLabel: null, cycles, api: 'v0' };
}

/**
 * Sanity probes: versions that certainly exist in each product. A failing probe means
 * the data (or its shape) changed in a way the page's matching would get wrong.
 */
const PROBES = {
  dotnetfx: ['4.5.1', '4.6.2', '4.8'],
  dotnet: ['3.1', '6.0', '8.0'],
  php: ['7.4.0', '8.2.0'],
  nodejs: ['14.0.0', '20.0.0'],
  angular: ['12.0.0'],
  laravel: ['8.0.0'],
  symfony: ['4.4.0'],
};

export function validateDataset(data) {
  const problems = [];
  for (const { id, required } of PRODUCTS) {
    const product = data.products[id];
    if (!product) {
      if (required) problems.push(`${id}: missing`);
      continue;
    }
    product.cycles.forEach((c, i) => {
      if (typeof c.name !== 'string' || !c.name) problems.push(`${id}[${i}]: name`);
      if (!(typeof c.eol === 'boolean' || ISO.test(c.eol))) problems.push(`${id}[${i}] ${c.name}: eol=${JSON.stringify(c.eol)}`);
      for (const f of ['eoas', 'eoes']) {
        if (!(c[f] === null || typeof c[f] === 'boolean' || ISO.test(c[f]))) problems.push(`${id}[${i}] ${c.name}: ${f}`);
      }
    });
    for (const version of PROBES[id] ?? []) {
      const found = findCycle(product, version);
      if (!found || found.match !== 'cycle') problems.push(`${id}: no release cycle matches ${version}`);
    }
  }
  const named = (id, fragment) => data.products[id]?.cycles.some((c) => `${c.name} ${c.label}`.includes(fragment));
  if (data.products.mssqlserver && !named('mssqlserver', '2016')) problems.push('mssqlserver: no 2016 cycle');
  if (data.products['windows-server'] && !named('windows-server', '2012')) problems.push('windows-server: no 2012 cycle');
  if (!ISO.test(data.generatedAt ?? '')) problems.push('generatedAt');
  return problems;
}

/** Stable comparison of the substantive content (everything except the fetch date). */
export function sameContent(a, b) {
  const strip = (d) => JSON.stringify({ ...d, generatedAt: undefined });
  return Boolean(a && b) && strip(a) === strip(b);
}
