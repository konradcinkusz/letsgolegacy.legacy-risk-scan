// Version arithmetic shared by the parsers and the end-of-life lookup.
//
// Two different questions are answered here, and they must not be confused:
//   • "which release cycle does this version belong to?"  → numericParts / isPrefix
//   • "what is the lowest version a constraint allows?"   → lowestVersion / nugetLowest
// The second one exists because composer.json and package.json hold constraints, not
// installed versions. When a lowest version cannot be determined honestly (a floating
// version, an exclusive lower bound, a dev branch) the answer is "unknown" with a
// reason, never a guess.

/** Leading dotted numeric parts: "4.5.1" → [4,5,1], "v1.2-beta" → [1,2], "3.5 SP1" → [3,5]. */
export function numericParts(value) {
  const m = /^\s*[vV=]?(\d+(?:\.\d+)*)/.exec(String(value ?? ''));
  return m ? m[1].split('.').map(Number) : null;
}

/** Compares numeric part arrays; missing parts count as 0. */
export function compareParts(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True when every part of `prefix` equals the corresponding part of `parts`. */
export function isPrefix(prefix, parts) {
  return prefix.length <= parts.length && prefix.every((p, i) => p === parts[i]);
}

function splitPrerelease(version) {
  const v = String(version).replace(/^[vV=]+/, '').split('+')[0];
  const dash = v.search(/[-]/);
  return dash < 0 ? { core: v, pre: '' } : { core: v.slice(0, dash), pre: v.slice(dash + 1) };
}

/** Compares two versions: numeric core first, then a pre-release sorts before its release. */
export function compareVersions(a, b) {
  const pa = splitPrerelease(a);
  const pb = splitPrerelease(b);
  const core = compareParts(numericParts(pa.core) ?? [0], numericParts(pb.core) ?? [0]);
  if (core !== 0) return core;
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const xa = pa.pre.split('.');
  const xb = pb.pre.split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1;
    if (xb[i] === undefined) return 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) < Number(xb[i]) ? -1 : 1;
    if (na !== nb) return na ? -1 : 1;
    const c = xa[i].localeCompare(xb[i], 'en', { sensitivity: 'base' });
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}

/** Pads a dotted numeric version to three parts, keeping any pre-release suffix. */
export function toThreeParts(version) {
  const { core, pre } = splitPrerelease(version);
  const parts = core.split('.');
  while (parts.length < 3) parts.push('0');
  return pre ? `${parts.join('.')}-${pre}` : parts.join('.');
}

/**
 * NuGet's normalised form: leading zeros dropped, at least three parts, a fourth part
 * only when it is non-zero, build metadata removed ("1.0.0.0" → "1.0.0", "1.01" → "1.1.0").
 */
export function normalizeNuGetVersion(version) {
  const { core, pre } = splitPrerelease(String(version).trim());
  if (!/^\d+(\.\d+){0,3}$/.test(core)) return null;
  const parts = core.split('.').map((p) => String(Number(p)));
  while (parts.length < 3) parts.push('0');
  if (parts.length === 4 && parts[3] === '0') parts.pop();
  return pre ? `${parts.join('.')}-${pre}` : parts.join('.');
}

const VERSION_TOKEN = /^[vV]?\d+(?:\.(?:\d+|[xX*]))*(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const unknown = (reason) => ({ version: null, kind: 'unknown', reason });

function lowerFromToken(token) {
  // Wildcards become zeros and end the version: "1.2.*" → 1.2.0, "1.x" → 1.0.0.
  const t = token.replace(/^[vV]/, '');
  const { core, pre } = splitPrerelease(t);
  const out = [];
  let wildcard = false;
  for (const part of core.split('.')) {
    if (/^[xX*]$/.test(part)) { wildcard = true; break; }
    out.push(String(Number(part)));
  }
  if (!out.length) return null;
  const base = toThreeParts(out.join('.'));
  return { version: wildcard || !pre ? base : `${base}-${pre}`, wildcard };
}

/**
 * One comparator atom → its contribution to the lower bound.
 * Returns {bound:{version,inclusive}} | {none:true} | {unknown:reason}.
 */
function atomBound(rawAtom, dialect) {
  let atom = rawAtom;
  if (dialect === 'composer') {
    if (/^dev-/i.test(atom) || /-dev$/i.test(atom.replace(/@\w+$/, ''))) return { unknown: 'dev-branch' };
    atom = atom.replace(/@(dev|alpha|beta|rc|stable)$/i, '');
    if (!atom) return { none: true };
  }
  if (/^[*xX]$/.test(atom)) return { none: true };
  const m = /^(>=|<=|!=|==|>|<|=|\^|~)?(.*)$/.exec(atom);
  const op = m[1] || '';
  const token = m[2];
  if (!VERSION_TOKEN.test(token)) return { unknown: 'unparseable' };
  if (op === '<' || op === '<=' || op === '!=') return { none: true };
  const lower = lowerFromToken(token);
  if (!lower) return { unknown: 'unparseable' };
  if (op === '>') return { bound: { version: lower.version, inclusive: false } };
  const exact = (op === '' || op === '=' || op === '==') && !lower.wildcard;
  return { bound: { version: lower.version, inclusive: true, exact } };
}

function lowestOfAlternative(alternative, dialect) {
  const alt = alternative.trim();
  if (!alt) return unknown('unparseable');
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(alt);
  if (hyphen) {
    if (!VERSION_TOKEN.test(hyphen[1])) return unknown('unparseable');
    return { version: lowerFromToken(hyphen[1]).version, kind: 'lowest' };
  }
  const compact = alt.replace(/(>=|<=|!=|==|>|<|=|\^|~)\s+/g, '$1');
  const atoms = compact.split(dialect === 'composer' ? /\s*,\s*|\s+/ : /\s+/).filter(Boolean);
  let best = null;
  let exactCount = 0;
  for (const atom of atoms) {
    const r = atomBound(atom, dialect);
    if (r.unknown) return unknown(r.unknown);
    if (r.none) continue;
    if (r.bound.exact) exactCount++;
    const c = best ? compareVersions(r.bound.version, best.version) : 1;
    if (c > 0 || (c === 0 && !r.bound.inclusive)) best = r.bound;
  }
  if (!best) return unknown('no-lower-bound');
  if (!best.inclusive) return unknown('exclusive-lower-bound');
  const kind = atoms.length === 1 && exactCount === 1 ? 'exact' : 'lowest';
  return { version: best.version, kind };
}

/**
 * The lowest version a Composer or npm constraint allows.
 * @param {string} constraint e.g. "^7.1.3", "~6.0 || ^7.0", ">=1.2 <2.0", "5.6.*"
 * @param {'composer'|'npm'} dialect
 * @returns {{version:string|null, kind:'exact'|'lowest'|'unknown', reason?:string}}
 */
export function lowestVersion(constraint, dialect = 'composer') {
  if (typeof constraint !== 'string' || !constraint.trim()) return unknown('no-lower-bound');
  const c = constraint.trim();
  if (dialect === 'npm') {
    if (/^(?:[a-z][a-z0-9+.-]*:|github:|git\+|\.{0,2}\/|~\/)/i.test(c) || /^[\w.-]+\/[\w.-]+(#.*)?$/.test(c)) {
      return unknown('non-registry');
    }
    if (/^[a-z][a-z0-9-]*$/i.test(c) && !/^x$/i.test(c)) return unknown('dist-tag');
  }
  const alternatives = c.split(/\s*\|\|?\s*/);
  let best = null;
  let reason = null;
  for (const alt of alternatives) {
    const r = lowestOfAlternative(alt, dialect);
    if (r.kind === 'unknown') {
      // A dev-branch alternative ("^2.0 || dev-main") does not hide the stable ones;
      // any other unknown alternative means the lowest version cannot be known.
      if (r.reason === 'dev-branch' && alternatives.length > 1) { reason ??= r.reason; continue; }
      return r;
    }
    if (!best || compareVersions(r.version, best.version) < 0) best = r;
  }
  if (!best) return unknown(reason ?? 'no-lower-bound');
  return alternatives.length > 1 ? { version: best.version, kind: 'lowest' } : best;
}

/**
 * NuGet version or range → the version to check.
 * "6.0.4" → exact; "[1.0,2.0)" → lowest 1.0.0; "(1.0,)" → unknown; "1.*" → floating.
 */
export function nugetLowest(spec) {
  const s = String(spec ?? '').trim();
  if (!s) return unknown('not-specified');
  if (s.includes('$(')) return unknown('unresolved-property');
  if (s.includes('*')) return unknown('floating');
  const range = /^([[(])\s*([^,\])]*?)\s*(?:,\s*([^\])]*?)\s*)?([\])])$/.exec(s);
  if (range) {
    const [, open, low, high, close] = range;
    const single = high === undefined;
    if (!low) return unknown('no-lower-bound');
    const v = normalizeNuGetVersion(low);
    if (!v) return unknown('unparseable');
    if (open === '(') return unknown('exclusive-lower-bound');
    if (single) return close === ']' ? { version: v, kind: 'exact' } : unknown('unparseable');
    return { version: v, kind: 'lowest' };
  }
  const v = normalizeNuGetVersion(s);
  return v ? { version: v, kind: 'exact' } : unknown('unparseable');
}
