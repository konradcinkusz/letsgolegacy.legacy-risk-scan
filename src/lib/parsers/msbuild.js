// MSBuild project files: SDK-style .csproj/.vbproj, the classic (pre-.NET Core) format,
// and Directory.Packages.props (central package management).
//
// What a classic project file reveals, and how:
//   <TargetFrameworkVersion>v4.5.1</…>              → the .NET Framework version
//   <Reference><HintPath>..\packages\Name.1.2.3\…  → NuGet package Name, version 1.2.3
//   <Reference><HintPath>..\lib\Vendor.dll          → a DLL copied in by hand
//   <Reference Include="Vendor.Lib, Version=…" />   → a component installed in the GAC
//   <Content Include="Scripts\jquery-1.10.2.js" />  → a JavaScript library, by file name
// and of an SDK-style one:
//   <TargetFramework(s)>, <PackageReference Include Version | <Version> | VersionOverride>
// A PackageReference without any version is reported as "version unknown": under central
// package management the version lives in Directory.Packages.props, not here.

import { attr, childElements, descendants } from '../xml.js';
import { parseTargetFramework, splitFrameworks } from '../frameworks.js';
import { nugetLowest, normalizeNuGetVersion } from '../versions.js';
import { matchScriptFile, npmAliasForNuGet } from '../known-libraries.js';

const MSBUILD_2003 = 'http://schemas.microsoft.com/developer/msbuild/2003';

// Out-of-band ASP.NET assemblies look like framework ones ("System.Web.Mvc") but ship
// separately and have their own versions, so a GAC reference to them is worth reporting.
const OUT_OF_BAND = /^System\.(?:Web\.(?:Mvc|WebPages|Razor|Helpers|Http|Optimization)|Net\.Http\.Formatting)(?:\.|$)/i;
const FRAMEWORK_ASSEMBLY =
  /^(?:System|mscorlib|netstandard|Microsoft\.CSharp|Microsoft\.VisualBasic|Microsoft\.JScript|WindowsBase|PresentationCore|PresentationFramework|Accessibility|ReachFramework|UIAutomation\w*|Microsoft\.Build(?:\.\w+)*)(?:\.|$)/i;

export function isFrameworkAssembly(name) {
  return !OUT_OF_BAND.test(name) && FRAMEWORK_ASSEMBLY.test(name);
}

/** "Newtonsoft.Json, Version=6.0.0.0, Culture=neutral" → { name, version } */
export function parseAssemblyReference(include) {
  const [name, ...rest] = String(include).split(',').map((s) => s.trim());
  const versionPart = rest.find((p) => /^Version\s*=/i.test(p));
  return { name, version: versionPart ? versionPart.split('=')[1].trim() : null };
}

/**
 * A NuGet packages-folder name → id and version: "Microsoft.AspNet.Mvc.5.2.2" →
 * { id: "Microsoft.AspNet.Mvc", version: "5.2.2" }. Package ids may themselves contain
 * numeric segments, so when the DLL's base name equals one candidate id, that one wins.
 */
export function splitPackageFolder(folder, dllBaseName) {
  const segments = folder.split('.');
  const candidates = [];
  for (let i = 1; i < segments.length; i++) {
    if (!/^\d/.test(segments[i])) continue;
    const version = segments.slice(i).join('.');
    if (/^\d+(?:\.\d+){1,3}(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
      candidates.push({ id: segments.slice(0, i).join('.'), version });
    }
  }
  if (!candidates.length) return null;
  const base = dllBaseName?.toLowerCase();
  return candidates.find((c) => c.id.toLowerCase() === base) ?? candidates[0];
}

function propertyResolver(root) {
  const props = new Map();
  for (const group of childElements(root, 'PropertyGroup')) {
    for (const p of group.children) {
      if (!p.children.length) props.set(p.localName.toLowerCase(), p.text.trim());
    }
  }
  const resolve = (value) => {
    let out = value;
    for (let depth = 0; depth < 5 && out.includes('$('); depth++) {
      out = out.replace(/\$\(([A-Za-z_][\w.-]*)\)/g, (m, name) => props.get(name.toLowerCase()) ?? m);
    }
    return out;
  };
  return { props, resolve };
}

function packageFromSpec(name, rawSpec, resolve, extra, missingReason = 'not-specified') {
  const spec = rawSpec?.trim() ? rawSpec.trim() : null;
  const resolved = spec ? resolve(spec) : null;
  const v = spec ? nugetLowest(resolved) : { version: null, kind: 'unknown', reason: missingReason };
  return {
    ecosystem: 'NuGet',
    name,
    spec,
    version: v.version,
    versionKind: v.kind,
    reason: v.reason,
    alsoNpm: npmAliasForNuGet(name),
    checkable: true,
    dev: false,
    ...extra,
  };
}

/**
 * @param {import('../xml.js').XmlElement} root the <Project> element
 */
export function parseMsbuild(root) {
  const { props, resolve } = propertyResolver(root);
  const hints = [];
  const runtimes = [];
  const packages = [];

  const isSdk =
    attr(root, 'Sdk') !== undefined ||
    childElements(root, 'Sdk').length > 0 ||
    childElements(root, 'Import').some((i) => attr(i, 'Sdk') !== undefined);

  // ── Target frameworks ──────────────────────────────────────────────────────
  const seenTfm = new Set();
  const addRuntime = (rawValue, origin) => {
    for (const value of splitFrameworks(resolve(rawValue))) {
      const key = value.toLowerCase();
      if (seenTfm.has(key)) continue;
      seenTfm.add(key);
      const rt = parseTargetFramework(value);
      if (rt) runtimes.push({ ...rt, origin });
    }
  };
  for (const el of descendants(root, 'TargetFrameworkVersion')) addRuntime(el.text, 'TargetFrameworkVersion');
  for (const el of descendants(root, 'TargetFramework')) addRuntime(el.text, 'TargetFramework');
  for (const el of descendants(root, 'TargetFrameworks')) addRuntime(el.text, 'TargetFrameworks');

  // ── Package references (SDK-style, and classic projects that adopted them) ──
  let missingVersions = 0;
  for (const el of descendants(root, 'PackageReference')) {
    const include = attr(el, 'Include');
    const name = include ?? attr(el, 'Update');
    if (!name) continue;
    const spec =
      attr(el, 'VersionOverride') ??
      childElements(el, 'VersionOverride')[0]?.text ??
      attr(el, 'Version') ??
      childElements(el, 'Version')[0]?.text;
    const privateAssets = attr(el, 'PrivateAssets') ?? childElements(el, 'PrivateAssets')[0]?.text;
    const pkg = packageFromSpec(
      name.trim(),
      spec,
      resolve,
      {
        origin: include ? 'package-reference' : 'package-reference-update',
        dev: /^all$/i.test(String(privateAssets ?? '').trim()),
      },
      'cpm',
    );
    if (!pkg.spec) missingVersions++;
    packages.push(pkg);
  }

  // ── Central package management: Directory.Packages.props ─────────────────
  const packageVersions = descendants(root, 'PackageVersion');
  for (const el of [...packageVersions, ...descendants(root, 'GlobalPackageReference')]) {
    const name = attr(el, 'Include') ?? attr(el, 'Update');
    if (!name) continue;
    const spec = attr(el, 'Version') ?? childElements(el, 'Version')[0]?.text;
    packages.push(packageFromSpec(name.trim(), spec, resolve, { origin: 'package-version' }));
  }
  if (missingVersions > 0) {
    const cpm = /^true$/i.test(props.get('managepackageversionscentrally') ?? '');
    hints.push({ code: 'HINT_CPM', params: { count: missingVersions, declared: cpm } });
  }

  // ── Assembly references (classic projects) ────────────────────────────────
  let frameworkRefs = 0;
  for (const el of descendants(root, 'Reference')) {
    const include = attr(el, 'Include');
    if (!include) continue;
    const assembly = parseAssemblyReference(resolve(include));
    const hintPath = childElements(el, 'HintPath')[0]?.text.trim();
    if (hintPath) {
      const path = resolve(hintPath);
      const segments = path.split(/[\\/]+/);
      // "..\packages\X", "..\..\packages\X", or "$(SolutionDir)packages\X" with the
      // property left unresolved: the segment is "packages" once any $(…) is removed.
      const idx = segments.findIndex((s) => s.replace(/\$\([^)]*\)/g, '').toLowerCase() === 'packages');
      const dllBase = segments[segments.length - 1].replace(/\.(dll|exe)$/i, '');
      if (idx >= 0 && idx + 1 < segments.length - 1) {
        const folder = segments[idx + 1];
        const split = splitPackageFolder(folder, dllBase);
        if (split) {
          const version = normalizeNuGetVersion(split.version);
          packages.push({
            ecosystem: 'NuGet',
            name: split.id,
            spec: split.version,
            version,
            versionKind: version ? 'exact' : 'unknown',
            reason: version ? undefined : 'unparseable',
            alsoNpm: npmAliasForNuGet(split.id),
            origin: 'hintpath',
            path,
            checkable: true,
            dev: false,
          });
        } else {
          packages.push({
            ecosystem: 'NuGet',
            name: folder,
            spec: null,
            version: null,
            versionKind: 'unknown',
            reason: 'package-folder-no-version',
            alsoNpm: null,
            origin: 'hintpath',
            path,
            checkable: true,
            dev: false,
          });
        }
      } else {
        packages.push({
          ecosystem: null,
          name: assembly.name,
          spec: assembly.version,
          version: null,
          versionKind: 'unknown',
          reason: 'manual-dll',
          assemblyVersion: assembly.version,
          origin: 'manual-dll',
          path,
          checkable: false,
          dev: false,
        });
      }
    } else if (!assembly.version || isFrameworkAssembly(assembly.name)) {
      frameworkRefs++;
    } else {
      packages.push({
        ecosystem: null,
        name: assembly.name,
        spec: assembly.version,
        version: null,
        versionKind: 'unknown',
        reason: 'gac',
        assemblyVersion: assembly.version,
        origin: 'gac',
        checkable: false,
        dev: false,
      });
    }
  }
  if (frameworkRefs > 0) hints.push({ code: 'HINT_FRAMEWORK_REFERENCES', params: { count: frameworkRefs } });

  const projectRefs = descendants(root, 'ProjectReference').length;
  if (projectRefs > 0) hints.push({ code: 'HINT_PROJECT_REFERENCES', params: { count: projectRefs } });

  // ── Script files and a packages.config next to the project ────────────────
  let hasPackagesConfig = false;
  for (const tag of ['Content', 'None']) {
    for (const el of descendants(root, tag)) {
      const include = resolve(attr(el, 'Include') ?? '');
      if (/(^|[\\/])packages\.config$/i.test(include)) hasPackagesConfig = true;
      const script = matchScriptFile(include);
      if (script) {
        packages.push({
          ecosystem: 'npm',
          name: script.npmName,
          spec: script.version,
          version: script.version.split('.').length < 3 ? `${script.version}.0` : script.version,
          versionKind: 'exact',
          alsoNpm: null,
          origin: 'script',
          path: include,
          checkable: true,
          dev: false,
        });
      }
    }
  }
  if (hasPackagesConfig) hints.push({ code: 'HINT_PACKAGES_CONFIG' });

  const format = packageVersions.length > 0
    ? 'cpm-props'
    : isSdk
      ? 'msbuild-sdk'
      : descendants(root, 'TargetFrameworkVersion').length > 0 || attr(root, 'xmlns') === MSBUILD_2003
        ? 'msbuild-legacy'
        : 'msbuild';

  return { format, runtimes, packages: dedupePackages(packages), hints };
}

/** One row per (ecosystem, name, version, origin kind); several DLLs of one package collapse. */
export function dedupePackages(packages) {
  const seen = new Map();
  for (const p of packages) {
    const key = [p.ecosystem ?? '-', p.name.toLowerCase(), p.version ?? p.spec ?? '?', p.checkable].join('|');
    if (!seen.has(key)) seen.set(key, p);
  }
  return [...seen.values()];
}
