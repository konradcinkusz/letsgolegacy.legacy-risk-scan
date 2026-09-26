// package.json: npm dependency ranges, checked at the lowest version each range allows
// (the same rule as composer.json), plus engines.node as the runtime row.

import { ScanError } from '../errors.js';
import { lowestVersion } from '../versions.js';

function section(obj, field) {
  const value = obj[field];
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new ScanError('MANIFEST_INVALID', { field });
  return value;
}

export function parsePackageJson(obj) {
  const packages = [];
  let constrained = 0;
  for (const [field, dev] of [['dependencies', false], ['optionalDependencies', false], ['devDependencies', true]]) {
    for (const [name, rawSpec] of Object.entries(section(obj, field))) {
      const spec = String(rawSpec ?? '').trim();
      const v = lowestVersion(spec, 'npm');
      if (v.kind !== 'exact') constrained++;
      packages.push({
        ecosystem: 'npm',
        name: name.trim(),
        spec,
        version: v.version,
        versionKind: v.kind,
        reason: v.reason,
        origin: field,
        checkable: true,
        dev,
      });
    }
  }
  const runtimes = [];
  const node = section(obj, 'engines').node;
  if (typeof node === 'string' && node.trim()) {
    const v = lowestVersion(node.trim(), 'npm');
    runtimes.push({
      product: 'nodejs',
      version: v.version,
      versionKind: v.kind,
      reason: v.reason,
      label: 'Node.js',
      raw: node.trim(),
      spec: node.trim(),
      origin: 'engines.node',
    });
  }
  const hints = constrained > 0 ? [{ code: 'HINT_NPM_RANGES' }] : [];
  return { format: 'package-json', runtimes, packages, hints };
}
