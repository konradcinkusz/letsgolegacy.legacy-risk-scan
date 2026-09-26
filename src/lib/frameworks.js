// Target framework → the runtime whose end-of-life date applies.
//
//   v4.5.1 (TargetFrameworkVersion), net451, net40-client, .NETFramework,Version=v4.8
//                                             → .NET Framework (endoflife.date "dotnetfx")
//   netcoreapp3.1, net6.0, net8.0-windows    → .NET / .NET Core ("dotnet")
//   netstandard2.0                           → .NET Standard: an API specification, not a
//                                              runtime, so it has no support end of its own
//
// The version is kept as written ("4.5.1", "8.0"); matching it to a release cycle is the
// end-of-life lookup's job (eol.js), because cycle names come from the data, not from here.

/**
 * @typedef {{ product: 'dotnetfx'|'dotnet'|'netstandard'|null, version: string|null,
 *             label: string, raw: string, reason?: string }} Runtime
 */

const fx = (version, raw) => ({ product: 'dotnetfx', version, label: `.NET Framework ${version}`, raw });

function core(version, raw) {
  const major = Number(version.split('.')[0]);
  // .NET 5 dropped "Core" from the name; the marketing label follows the major version.
  const label = major >= 5 ? `.NET ${major}` : `.NET Core ${version}`;
  return { product: 'dotnet', version, label, raw };
}

const std = (version, raw) => ({ product: 'netstandard', version, label: `.NET Standard ${version}`, raw });

/**
 * @param {string} value a TFM, a TargetFrameworkVersion or a long-form moniker
 * @returns {Runtime|null} null for an empty value
 */
export function parseTargetFramework(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (raw.includes('$(')) return { product: null, version: null, label: raw, raw, reason: 'unresolved-property' };

  let m = /^\.NETFramework\s*,\s*Version\s*=\s*v?(\d+(?:\.\d+)+)/i.exec(raw);
  if (m) return fx(m[1], raw);
  m = /^\.NETCoreApp\s*,\s*Version\s*=\s*v?(\d+\.\d+)/i.exec(raw);
  if (m) return core(m[1], raw);
  m = /^\.NETStandard\s*,\s*Version\s*=\s*v?(\d+\.\d+)/i.exec(raw);
  if (m) return std(m[1], raw);

  const t = raw.toLowerCase();
  m = /^v(\d+(?:\.\d+)+)$/.exec(t);
  if (m) return fx(m[1], raw);
  // Short .NET Framework TFMs carry no dots: net11, net20, net35, net40, net403, net45,
  // net451 … net481, optionally with a profile suffix (net40-client, net45-full).
  m = /^net(\d)(\d)(\d)?(?:-[a-z]+)?$/.exec(t);
  if (m) return fx([m[1], m[2], m[3]].filter(Boolean).join('.'), raw);
  m = /^net(\d+)\.(\d+)(?:-[a-z0-9.]+)?$/.exec(t);
  if (m && Number(m[1]) >= 5) return core(`${Number(m[1])}.${Number(m[2])}`, raw);
  m = /^netcoreapp(\d+)\.(\d+)$/.exec(t);
  if (m) return core(`${m[1]}.${m[2]}`, raw);
  m = /^netstandard(\d+)\.(\d+)$/.exec(t);
  if (m) return std(`${m[1]}.${m[2]}`, raw);

  return { product: null, version: null, label: raw, raw, reason: 'unsupported-framework' };
}

/** Splits a TargetFrameworks value ("net48;net8.0") into its parts. */
export function splitFrameworks(value) {
  return String(value ?? '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}
