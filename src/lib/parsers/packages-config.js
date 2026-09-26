// packages.config: the classic NuGet manifest. Every <package> carries an exact version
// and the target framework the project had when the package was installed — which is a
// floor for the project's framework today, not proof of it (retargeting a project does
// not rewrite this file), so the report says so.

import { attr, childElements } from '../xml.js';
import { parseTargetFramework } from '../frameworks.js';
import { nugetLowest, compareParts, numericParts } from '../versions.js';
import { npmAliasForNuGet } from '../known-libraries.js';
import { dedupePackages } from './msbuild.js';

/** @param {import('../xml.js').XmlElement} root the <packages> element */
export function parsePackagesConfig(root) {
  const packages = [];
  const frameworks = new Map();
  for (const el of childElements(root, 'package')) {
    const id = attr(el, 'id')?.trim();
    if (!id) continue;
    const spec = attr(el, 'version')?.trim() || null;
    const v = spec ? nugetLowest(spec) : { version: null, kind: 'unknown', reason: 'not-specified' };
    packages.push({
      ecosystem: 'NuGet',
      name: id,
      spec,
      version: v.version,
      versionKind: v.kind,
      reason: v.reason,
      alsoNpm: npmAliasForNuGet(id),
      origin: 'packages-config',
      checkable: true,
      dev: /^true$/i.test(attr(el, 'developmentDependency') ?? ''),
    });
    const tfm = attr(el, 'targetFramework')?.trim();
    if (tfm) {
      const rt = parseTargetFramework(tfm);
      if (rt) frameworks.set(tfm.toLowerCase(), rt);
    }
  }

  // The newest .NET Framework among the targetFramework attributes is the best available
  // estimate of the project's framework; anything else (netstandard, net6.0) is listed.
  const runtimes = [];
  let newestFx = null;
  for (const rt of frameworks.values()) {
    if (rt.product === 'dotnetfx') {
      if (!newestFx || compareParts(numericParts(rt.version), numericParts(newestFx.version)) > 0) newestFx = rt;
    } else {
      runtimes.push({ ...rt, origin: 'packages-config' });
    }
  }
  if (newestFx) runtimes.unshift({ ...newestFx, origin: 'packages-config' });

  const hints = [];
  if (runtimes.length) hints.push({ code: 'HINT_PACKAGES_CONFIG_FRAMEWORK' });
  return { format: 'packages-config', runtimes, packages: dedupePackages(packages), hints };
}
