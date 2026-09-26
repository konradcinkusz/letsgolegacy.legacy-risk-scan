// composer.json and composer.lock.
//
// composer.json holds constraints ("^7.1.3", "5.6.*"), not installed versions. For each
// package the scan checks the LOWEST version the constraint allows, and says so; where no
// lowest version can be determined honestly (a dev branch, "*", an exclusive bound) the
// package is reported as "version unknown". The "php" constraint becomes the runtime
// row: the minimum PHP version the application declares it can run on.
// composer.lock holds exact versions and is the precise input.

import { ScanError } from '../errors.js';
import { lowestVersion } from '../versions.js';

const PLATFORM = /^(?:php(?:-64bit|-ipv6|-zts|-debug)?|hhvm|composer|composer-plugin-api|composer-runtime-api|ext-.+|lib-.+)$/i;

export const isPlatformPackage = (name) => PLATFORM.test(name);

function requireObject(obj, field) {
  const value = obj[field];
  if (value === undefined || value === null) return {};
  // Composer writes an empty object as [] in some tools' output; treat that as empty.
  if (Array.isArray(value) && value.length === 0) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new ScanError('MANIFEST_INVALID', { field });
  return value;
}

function phpRuntime(spec, origin) {
  const v = lowestVersion(String(spec), 'composer');
  return {
    product: 'php',
    version: v.version,
    versionKind: v.kind,
    reason: v.reason,
    label: 'PHP',
    raw: String(spec),
    spec: String(spec),
    origin,
  };
}

export function parseComposerJson(obj) {
  const packages = [];
  const runtimes = [];
  const skipped = [];
  let constrained = 0;
  for (const [field, dev] of [['require', false], ['require-dev', true]]) {
    for (const [rawName, rawSpec] of Object.entries(requireObject(obj, field))) {
      const name = rawName.trim().toLowerCase();
      const spec = String(rawSpec ?? '').trim();
      if (name === 'php') {
        if (!dev) runtimes.push(phpRuntime(spec, 'require.php'));
        continue;
      }
      if (isPlatformPackage(name)) {
        skipped.push(name);
        continue;
      }
      const v = lowestVersion(spec, 'composer');
      if (v.kind !== 'exact') constrained++;
      packages.push({
        ecosystem: 'Packagist',
        name,
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
  const platformPhp = obj.config?.platform?.php;
  if (typeof platformPhp === 'string' && platformPhp.trim()) {
    runtimes.push(phpRuntime(platformPhp.trim(), 'config.platform.php'));
  }
  const hints = [];
  if (constrained > 0) hints.push({ code: 'HINT_COMPOSER_CONSTRAINTS' });
  if (skipped.length) hints.push({ code: 'HINT_PLATFORM_PACKAGES', params: { names: skipped } });
  return { format: 'composer-json', runtimes, packages, hints };
}

export function parseComposerLock(obj) {
  const packages = [];
  for (const [field, dev] of [['packages', false], ['packages-dev', true]]) {
    const list = obj[field] ?? [];
    if (!Array.isArray(list)) throw new ScanError('MANIFEST_INVALID', { field });
    for (const entry of list) {
      if (!entry || typeof entry.name !== 'string') continue;
      const name = entry.name.trim().toLowerCase();
      const spec = String(entry.version ?? '').trim();
      const isDevBranch = /^dev-/i.test(spec) || /-dev$/i.test(spec);
      const version = spec.replace(/^v(?=\d)/i, '');
      const valid = !isDevBranch && /^\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/.test(version);
      packages.push({
        ecosystem: 'Packagist',
        name,
        spec,
        version: valid ? version : null,
        versionKind: valid ? 'exact' : 'unknown',
        reason: valid ? undefined : isDevBranch ? 'dev-branch' : 'unparseable',
        origin: dev ? 'lock-dev' : 'lock',
        checkable: true,
        dev,
      });
    }
  }
  const runtimes = [];
  const platform = requireObject(obj, 'platform');
  if (typeof platform.php === 'string') runtimes.push(phpRuntime(platform.php, 'platform.php'));
  const override = requireObject(obj, 'platform-overrides');
  if (typeof override.php === 'string') runtimes.push(phpRuntime(override.php, 'platform-overrides.php'));
  return { format: 'composer-lock', runtimes, packages, hints: [] };
}
