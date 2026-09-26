// Manifest + end-of-life data + OSV results → the report's rows and summary.
//
// Pure: no DOM, no network, no display text. Each row carries codes (notes) that
// messages.js turns into Polish, so the classification is testable on its own.
//
// Status rules, per row:
//   flags.eol       the release cycle's support has ended
//   flags.eolSoon   … ends within 12 months
//   flags.vulnerable at least one known, non-withdrawn advisory
//   assessed        enough was known to say "nothing found" (a version, and an answer
//                   from OSV for a package; a matched release cycle for a runtime)
// The primary status is the worst flag; a row with no flag is "ok" only if it was
// assessed, otherwise "unknown". A row can count in several summary buckets (a runtime
// past its end of life with known vulnerabilities is both), which the page says.

import { assessVersion, assessCycle } from './eol.js';
import { coordinateKey, summarizeVulnerability, mergeAdvisories, uniqueCoordinates } from './osv.js';
import { productForPackage } from './known-libraries.js';
import { numericParts } from './versions.js';
import { cleanServerLabel, servicePackOf } from './servers.js';

export const STATUS_ORDER = ['eol', 'vulnerable', 'eol-soon', 'unknown', 'ok'];

/** Coordinates to ask OSV about: every checkable package with a version, plus npm aliases. */
export function coordinatesFor(manifest) {
  const coords = [];
  for (const p of manifest.packages) {
    if (!p.checkable || !p.version || !p.ecosystem) continue;
    coords.push({ ecosystem: p.ecosystem, name: p.name, version: p.version });
    if (p.alsoNpm) coords.push({ ecosystem: 'npm', name: p.alsoNpm, version: p.version });
  }
  return uniqueCoordinates(coords);
}

function runtimeName(rt) {
  switch (rt.product) {
    case 'dotnetfx': return '.NET Framework';
    case 'dotnet': return (numericParts(rt.version)?.[0] ?? 0) >= 5 ? '.NET' : '.NET Core';
    case 'netstandard': return '.NET Standard';
    case 'php': return 'PHP';
    case 'nodejs': return 'Node.js';
    default: return 'Framework';
  }
}

function eolNotes(eol, today) {
  const notes = [];
  if (!eol) return notes;
  if (eol.status === 'no-data') notes.push({ code: 'EOL_NO_DATA', params: { product: eol.productLabel } });
  if (eol.match === 'older-than-cycle' && eol.status === 'eol') {
    notes.push({
      code: eol.olderThanDate ? 'EOL_OLDER_THAN_CYCLE' : 'EOL_OLDER_THAN_CYCLE_NODATE',
      params: { cycle: eol.cycleLabel, date: eol.olderThanDate },
    });
  }
  if (eol.status === 'eol' && eol.eoesDate) {
    notes.push({ code: eol.eoesDate > today ? 'EOL_ESU_UNTIL' : 'EOL_ESU_ENDED', params: { date: eol.eoesDate } });
  }
  if ((eol.status === 'supported' || eol.status === 'eol-soon') && eol.eoasPassed && eol.eoasDate) {
    notes.push({ code: 'EOL_SECURITY_ONLY', params: { date: eol.eoasDate } });
  }
  if (eol.status === 'supported' && !eol.eolDate) notes.push({ code: 'EOL_NO_DATE' });
  return notes;
}

function runtimeItem(rt, eolData, today) {
  const notes = [];
  let eol = null;
  let assessed = false;
  if (rt.product === 'netstandard') {
    assessed = true;
    notes.push({ code: 'RUNTIME_NETSTANDARD' });
  } else if (rt.product) {
    if (rt.version) {
      eol = assessVersion(eolData, rt.product, rt.version, today);
      assessed = Boolean(eol && eol.status !== 'no-data');
    }
    if (rt.versionKind === 'lowest') notes.push({ code: 'RUNTIME_MINIMUM', params: { spec: rt.spec } });
    if (!rt.version) notes.push({ code: `VERSION_${(rt.reason ?? 'unparseable').toUpperCase().replace(/-/g, '_')}`, params: { spec: rt.spec ?? rt.raw } });
    if (rt.origin === 'config.platform.php' || rt.origin === 'platform-overrides.php') notes.push({ code: 'RUNTIME_PLATFORM_OVERRIDE' });
  } else {
    notes.push({ code: rt.reason === 'unresolved-property' ? 'RUNTIME_UNRESOLVED' : 'RUNTIME_UNSUPPORTED', params: { value: rt.raw } });
  }
  notes.push(...eolNotes(eol, today));
  return {
    kind: 'runtime',
    name: runtimeName(rt),
    version: rt.version,
    spec: rt.spec ?? null,
    versionKind: rt.versionKind ?? 'exact',
    source: { origin: rt.origin, value: rt.raw },
    ecosystem: null,
    eol,
    advisoryState: 'not-applicable',
    advisories: [],
    assessed,
    notes,
  };
}

function infraItem(productId, cycleName, eolData, today) {
  const eol = assessCycle(eolData, productId, cycleName, today);
  const label = eolData?.products?.[productId]?.label ?? productId;
  const servicePack = eol ? servicePackOf(eol.cycleLabel) : null;
  return {
    kind: 'infrastructure',
    name: label,
    version: eol ? cleanServerLabel(eol.cycleLabel) : cycleName,
    spec: null,
    versionKind: 'exact',
    source: { origin: 'form', value: cycleName },
    ecosystem: null,
    eol,
    advisoryState: 'not-applicable',
    advisories: [],
    assessed: Boolean(eol),
    notes: [
      ...(eol ? [] : [{ code: 'EOL_NO_DATA', params: { product: label } }]),
      ...(servicePack ? [{ code: 'INFRA_SERVICE_PACK', params: { sp: servicePack } }] : []),
      ...eolNotes(eol, today),
    ],
  };
}

function packageItem(p, eolData, osv, today) {
  const notes = [];
  const productId = p.ecosystem ? productForPackage(p.ecosystem, p.name) : null;
  const eol = productId && p.version ? assessVersion(eolData, productId, p.version, today) : null;

  let advisoryState;
  let advisories = [];
  if (!p.checkable) advisoryState = 'not-checkable';
  else if (!p.version) advisoryState = 'unknown-version';
  else if (osv.state === 'error') advisoryState = 'error';
  else if (osv.state !== 'ok') advisoryState = 'not-checked';
  else {
    advisoryState = 'checked';
    const targets = [{ ecosystem: p.ecosystem, name: p.name, version: p.version }];
    if (p.alsoNpm) targets.push({ ecosystem: 'npm', name: p.alsoNpm, version: p.version });
    const found = [];
    for (const t of targets) {
      for (const id of osv.idsByCoordinate.get(coordinateKey(t)) ?? []) {
        found.push(summarizeVulnerability(id, osv.records.get(id) ?? null, targets));
      }
    }
    advisories = mergeAdvisories(found);
  }

  switch (p.reason) {
    case undefined:
    case null:
      break;
    case 'manual-dll':
      notes.push({ code: 'SOURCE_MANUAL_DLL', params: { path: p.path, version: p.assemblyVersion } });
      break;
    case 'gac':
      notes.push({ code: 'SOURCE_GAC', params: { version: p.assemblyVersion } });
      break;
    default:
      notes.push({ code: `VERSION_${p.reason.toUpperCase().replace(/-/g, '_')}`, params: { spec: p.spec ?? '', path: p.path ?? '' } });
  }
  if (p.versionKind === 'lowest') notes.push({ code: 'VERSION_LOWEST', params: { spec: p.spec, version: p.version } });
  if (p.origin === 'script') notes.push({ code: 'SOURCE_SCRIPT', params: { path: p.path } });
  if (p.alsoNpm && advisoryState === 'checked') notes.push({ code: 'ALSO_NPM', params: { name: p.alsoNpm } });
  if (p.dev) notes.push({ code: 'DEV_DEPENDENCY' });
  if (advisoryState === 'error') notes.push({ code: 'OSV_UNAVAILABLE' });
  if (advisories.some((a) => !a.detailsAvailable)) notes.push({ code: 'OSV_DETAILS_MISSING' });
  notes.push(...eolNotes(eol, today));

  return {
    kind: 'package',
    name: p.name,
    version: p.version,
    spec: p.spec,
    versionKind: p.versionKind,
    source: { origin: p.origin, value: p.path ?? p.spec ?? '' },
    ecosystem: p.ecosystem,
    eol,
    advisoryState,
    advisories,
    assessed: advisoryState === 'checked',
    notes,
  };
}

function finalize(item) {
  const flags = {
    eol: item.eol?.status === 'eol',
    eolSoon: item.eol?.status === 'eol-soon',
    vulnerable: item.advisories.length > 0,
  };
  let status;
  if (flags.eol) status = 'eol';
  else if (flags.vulnerable) status = 'vulnerable';
  else if (flags.eolSoon) status = 'eol-soon';
  else status = item.assessed ? 'ok' : 'unknown';
  return { ...item, flags, status };
}

/**
 * @param {import('./manifest.js').Manifest} manifest
 * @param {{
 *   eolData: object,
 *   osv: { state: 'ok'|'error'|'skipped', idsByCoordinate?: Map<string,string[]>,
 *          records?: Map<string, object|null>, errorKind?: string },
 *   today: string,
 *   infra?: { mssqlserver?: string, 'windows-server'?: string },
 * }} context
 */
export function buildReport(manifest, { eolData, osv, today, infra = {} }) {
  const items = [
    ...manifest.runtimes.map((rt) => runtimeItem(rt, eolData, today)),
    ...['windows-server', 'mssqlserver'].filter((id) => infra[id]).map((id) => infraItem(id, infra[id], eolData, today)),
    ...manifest.packages.map((p) => packageItem(p, eolData, osv, today)),
  ].map(finalize);

  const rank = (s) => STATUS_ORDER.indexOf(s);
  const byRisk = (a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name, 'pl');
  const platform = items.filter((i) => i.kind !== 'package').sort(byRisk);
  const dependencies = items.filter((i) => i.kind === 'package').sort(byRisk);

  const summary = {
    total: items.length,
    eol: items.filter((i) => i.flags.eol).length,
    eolSoon: items.filter((i) => i.flags.eolSoon).length,
    vulnerable: items.filter((i) => i.flags.vulnerable).length,
    ok: items.filter((i) => i.status === 'ok').length,
    unknown: items.filter((i) => i.status === 'unknown').length,
    advisories: new Set(items.flatMap((i) => i.advisories.map((a) => a.id))).size,
  };

  return {
    format: manifest.format,
    today,
    dataDate: eolData?.generatedAt ?? null,
    osvState: osv.state,
    osvErrorKind: osv.errorKind ?? null,
    hints: manifest.hints,
    platform,
    dependencies,
    summary,
  };
}
