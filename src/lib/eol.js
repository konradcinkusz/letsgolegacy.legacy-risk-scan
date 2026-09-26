// End-of-life lookup against the bundled, dated dataset (data/eol.json).
//
// Status is computed from the dates at the moment the report is produced, not frozen
// when the data was fetched: .NET 8's support ending on 2026-11-10 turns the row from
// "ends within 12 months" into "ended" on that day even if nobody refreshed the data.
// The data's own date is shown in the report so its freshness is never implied.

import { numericParts, isPrefix, compareParts } from './versions.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar date as YYYY-MM-DD. */
export function todayIso(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Adds calendar months, clamping to the month's last day (2028-02-29 + 12 → 2029-02-28). */
export function addMonthsIso(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const p = (n) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(Math.min(d, last))}`;
}

/** true (ended, no date), false (no end announced), or an ISO date → is it over by `today`? */
function isPast(value, today) {
  if (value === true) return true;
  return typeof value === 'string' && ISO_DATE.test(value) && value <= today;
}

/**
 * The status of one release cycle on a given day.
 * @returns {{ status: 'eol'|'eol-soon'|'supported', eolDate: string|null }}
 */
export function cycleStatus(cycle, today) {
  const eol = cycle.eol;
  if (typeof eol === 'string' && ISO_DATE.test(eol)) {
    if (eol <= today) return { status: 'eol', eolDate: eol };
    if (eol <= addMonthsIso(today, 12)) return { status: 'eol-soon', eolDate: eol };
    return { status: 'supported', eolDate: eol };
  }
  return { status: eol === true ? 'eol' : 'supported', eolDate: null };
}

/**
 * The release cycle a version belongs to: the cycle whose name is the longest numeric
 * prefix of the version ("4.5.1" → "4.5.1" before "4.5"; "8.0" → "8"; "7.1.3" → "7.1").
 * A version older than every tracked cycle is reported as such — endoflife.date does not
 * list every ancient release, and "older than the oldest one listed" is still an answer.
 */
export function findCycle(product, version) {
  const parts = numericParts(version);
  if (!parts || !product?.cycles?.length) return null;
  const numbered = product.cycles
    .map((cycle) => ({ cycle, cp: numericParts(cycle.name) }))
    .filter((c) => c.cp);
  let best = null;
  for (const { cycle, cp } of numbered) {
    if (!isPrefix(cp, parts)) continue;
    // A short name with more specific siblings stands for its ".0" release: in
    // .NET Framework's list, "4" is 4.0 (4.5 and 4.8 are cycles of their own), so an
    // unlisted 4.7.2 must not be reported as 4.0. Without siblings, "8" means all of 8.x.
    const hasSpecificSiblings = numbered.some((o) => o.cp.length > cp.length && isPrefix(cp, o.cp));
    if (hasSpecificSiblings && (parts[cp.length] ?? 0) !== 0) continue;
    if (!best || cp.length > best.len) best = { cycle, len: cp.length };
  }
  if (best) return { cycle: best.cycle, match: 'cycle' };
  if (numbered.length && numbered.every((c) => compareParts(parts, c.cp) < 0)) {
    const oldest = numbered.reduce((a, b) => (compareParts(a.cp, b.cp) <= 0 ? a : b));
    return { cycle: oldest.cycle, match: 'older-than-tracked' };
  }
  return null;
}

function describe(dataset, productId, cycle, match, today) {
  const product = dataset.products[productId];
  const base = {
    product: productId,
    productLabel: product.label,
    link: product.link,
    cycle: cycle.name,
    cycleLabel: cycle.label || cycle.name,
    match,
    lts: cycle.lts === true,
    latest: cycle.latest ?? null,
    eoasDate: typeof cycle.eoas === 'string' ? cycle.eoas : null,
    eoesDate: typeof cycle.eoes === 'string' ? cycle.eoes : null,
    eoasPassed: isPast(cycle.eoas, today),
  };
  if (match === 'older-than-tracked') {
    // Only meaningful when even the oldest tracked cycle is already over.
    const oldest = cycleStatus(cycle, today);
    if (oldest.status !== 'eol') return { ...base, status: 'no-data', eolDate: null };
    return { ...base, status: 'eol', eolDate: null, olderThanDate: oldest.eolDate };
  }
  return { ...base, ...cycleStatus(cycle, today) };
}

/**
 * @param {object} dataset parsed data/eol.json
 * @param {string} productId endoflife.date product id ("dotnetfx", "php", …)
 * @param {string|null} version
 * @param {string} today YYYY-MM-DD
 * @returns {null | object} null when the dataset does not track the product at all;
 *   { status: 'no-data' } when it does but the version matches no cycle.
 */
export function assessVersion(dataset, productId, version, today) {
  const product = dataset?.products?.[productId];
  if (!product) return null;
  const found = version ? findCycle(product, version) : null;
  if (!found) {
    return { product: productId, productLabel: product.label, link: product.link, status: 'no-data', eolDate: null };
  }
  return describe(dataset, productId, found.cycle, found.match, today);
}

/** For a cycle picked from a list (the SQL Server / Windows Server selects). */
export function assessCycle(dataset, productId, cycleName, today) {
  const product = dataset?.products?.[productId];
  const cycle = product?.cycles.find((c) => c.name === cycleName);
  return cycle ? describe(dataset, productId, cycle, 'cycle', today) : null;
}
