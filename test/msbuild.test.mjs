import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../src/lib/manifest.js';
import { isFrameworkAssembly, splitPackageFolder } from '../src/lib/parsers/msbuild.js';
import { fixture, sample } from './helpers.mjs';

const byName = (packages, name) => packages.filter((p) => p.name === name);
const one = (packages, name) => {
  const found = byName(packages, name);
  assert.equal(found.length, 1, `exactly one row for ${name}, got ${found.length}`);
  return found[0];
};

test('classic .csproj (the public sample): framework from TargetFrameworkVersion', () => {
  const m = parseManifest(sample('Sklep.Legacy.csproj'));
  assert.equal(m.format, 'msbuild-legacy');
  assert.equal(m.runtimes.length, 1);
  assert.equal(m.runtimes[0].product, 'dotnetfx');
  assert.equal(m.runtimes[0].version, '4.5.1');
  assert.equal(m.runtimes[0].origin, 'TargetFrameworkVersion');
});

test('classic .csproj: NuGet id and version inferred from HintPath into packages\\Name.Version\\', () => {
  const { packages } = parseManifest(sample('Sklep.Legacy.csproj'));
  const expected = {
    'Newtonsoft.Json': '6.0.4',
    'Microsoft.AspNet.Mvc': '5.2.2',
    'Microsoft.AspNet.WebPages': '3.2.2',
    'Microsoft.AspNet.Razor': '3.2.2',
    'Microsoft.AspNet.Web.Optimization': '1.1.3',
    EntityFramework: '6.1.1',
    Antlr: '3.4.1.9004',
    WebGrease: '1.5.2',
    log4net: '2.0.3',
    SharpZipLib: '0.86.0',
    'Microsoft.Owin': '2.1.0',
    Owin: '1.0.0',
    'Microsoft.Web.Infrastructure': '1.0.0',
  };
  for (const [name, version] of Object.entries(expected)) {
    const p = one(packages, name);
    assert.equal(p.ecosystem, 'NuGet');
    assert.equal(p.version, version, name);
    assert.equal(p.versionKind, 'exact');
    assert.equal(p.origin, 'hintpath');
  }
});

test('classic .csproj: several DLLs from one package collapse into one row', () => {
  const { packages } = parseManifest(sample('Sklep.Legacy.csproj'));
  one(packages, 'Microsoft.AspNet.WebPages'); // System.Web.Helpers, .WebPages, .WebPages.Razor
  one(packages, 'EntityFramework'); // EntityFramework, EntityFramework.SqlServer
});

test('classic .csproj: a hand-copied DLL and a GAC component are reported, not guessed', () => {
  const { packages } = parseManifest(sample('Sklep.Legacy.csproj'));
  const manual = one(packages, 'Drukarki.Etykiety');
  assert.equal(manual.checkable, false);
  assert.equal(manual.reason, 'manual-dll');
  assert.equal(manual.assemblyVersion, '1.3.0.0');
  assert.equal(manual.version, null, 'an assembly version is not a package version');
  const gac = one(packages, 'CrystalDecisions.CrystalReports.Engine');
  assert.equal(gac.reason, 'gac');
  assert.equal(gac.assemblyVersion, '13.0.2000.0');
});

test('classic .csproj: script files with a version in the name become npm packages', () => {
  const { packages } = parseManifest(sample('Sklep.Legacy.csproj'));
  const jquery = one(packages, 'jquery'); // jquery-1.10.2.js, .min.js and .intellisense.js
  assert.equal(jquery.ecosystem, 'npm');
  assert.equal(jquery.version, '1.10.2');
  assert.equal(jquery.origin, 'script');
  assert.equal(one(packages, 'modernizr').version, '2.6.2');
  assert.equal(byName(packages, 'jquery-validation').length, 0, 'jquery.validate.js has no version in its name');
});

test('classic .csproj: framework assemblies are skipped and counted; hints point at packages.config', () => {
  const m = parseManifest(sample('Sklep.Legacy.csproj'));
  assert.equal(byName(m.packages, 'System.Web').length, 0);
  const codes = Object.fromEntries(m.hints.map((h) => [h.code, h.params ?? {}]));
  assert.equal(codes.HINT_FRAMEWORK_REFERENCES.count, 22);
  assert.equal(codes.HINT_PROJECT_REFERENCES.count, 1);
  assert.ok('HINT_PACKAGES_CONFIG' in codes);
});

test('SDK-style .csproj: TargetFrameworks, Version attribute, <Version> element, properties, ranges', () => {
  const m = parseManifest(fixture('manifests/Sdk.Multi.csproj'));
  assert.equal(m.format, 'msbuild-sdk');
  assert.deepEqual(
    m.runtimes.map((r) => [r.product, r.version]),
    [['dotnetfx', '4.8'], ['dotnet', '6.0'], ['netstandard', '2.0']],
  );
  const p = (name) => one(m.packages, name);
  assert.equal(p('Newtonsoft.Json').version, '12.0.3');
  assert.equal(p('Dapper').version, '2.0.123', 'child <Version> element');
  assert.equal(p('Serilog').version, '2.10.0', '$(SerilogVersion) resolved from a PropertyGroup');
  assert.equal(p('Polly').reason, 'unresolved-property');
  assert.equal(p('AutoMapper').version, '10.0.0');
  assert.equal(p('AutoMapper').versionKind, 'lowest');
  assert.equal(p('MediatR').reason, 'floating');
  assert.equal(p('Azure.Identity').version, '1.10.2', 'VersionOverride');
  assert.equal(p('StyleCop.Analyzers').dev, true, 'PrivateAssets="all" is build-time only');
  assert.equal(p('jQuery').alsoNpm, 'jquery');
});

test('SDK-style .csproj: a PackageReference without a version is a central-package-management gap', () => {
  const m = parseManifest(fixture('manifests/Sdk.Multi.csproj'));
  const sqlClient = one(m.packages, 'Microsoft.Data.SqlClient');
  assert.equal(sqlClient.version, null);
  assert.equal(sqlClient.versionKind, 'unknown');
  assert.equal(sqlClient.reason, 'cpm');
  assert.deepEqual(m.hints.find((h) => h.code === 'HINT_CPM').params, { count: 1, declared: false });
});

test('Directory.Packages.props: central versions are read as packages', () => {
  const m = parseManifest(fixture('manifests/Directory.Packages.props'));
  assert.equal(m.format, 'cpm-props');
  assert.equal(one(m.packages, 'Microsoft.Data.SqlClient').version, '5.1.1');
  assert.equal(one(m.packages, 'Nerdbank.GitVersioning').version, '3.6.133');
  assert.equal(m.runtimes.length, 0);
});

test('packages folder names split into id and version, preferring the DLL name on ambiguity', () => {
  assert.deepEqual(splitPackageFolder('Microsoft.AspNet.Mvc.5.2.2', 'System.Web.Mvc'), { id: 'Microsoft.AspNet.Mvc', version: '5.2.2' });
  assert.deepEqual(splitPackageFolder('Antlr.3.4.1.9004', 'Antlr3.Runtime'), { id: 'Antlr', version: '3.4.1.9004' });
  assert.deepEqual(splitPackageFolder('Owin.1.0', 'Owin'), { id: 'Owin', version: '1.0' });
  assert.deepEqual(splitPackageFolder('Foo.2.1.0', 'Foo.2'), { id: 'Foo.2', version: '1.0' });
  assert.deepEqual(splitPackageFolder('Foo.2.1.0', 'Foo'), { id: 'Foo', version: '2.1.0' });
  assert.deepEqual(splitPackageFolder('Identity.Core.2.0.0-beta1', 'x'), { id: 'Identity.Core', version: '2.0.0-beta1' });
  assert.equal(splitPackageFolder('Newtonsoft.Json', 'Newtonsoft.Json'), null);
});

test('HintPath forms: nested packages folder and an unresolved $(SolutionDir)', () => {
  const m = parseManifest(`<Project ToolsVersion="4.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">
    <ItemGroup>
      <Reference Include="A"><HintPath>..\\..\\packages\\A.1.2.3\\lib\\net40\\A.dll</HintPath></Reference>
      <Reference Include="B"><HintPath>$(SolutionDir)packages\\B.4.5.6\\lib\\B.dll</HintPath></Reference>
      <Reference Include="C"><HintPath>..\\packages\\C\\lib\\C.dll</HintPath></Reference>
    </ItemGroup></Project>`);
  assert.equal(one(m.packages, 'A').version, '1.2.3');
  assert.equal(one(m.packages, 'B').version, '4.5.6');
  assert.equal(one(m.packages, 'C').reason, 'package-folder-no-version');
});

test('framework assemblies versus out-of-band ASP.NET assemblies', () => {
  for (const name of ['System', 'System.Web', 'System.Data.Entity', 'Microsoft.CSharp', 'WindowsBase', 'PresentationFramework']) {
    assert.equal(isFrameworkAssembly(name), true, name);
  }
  for (const name of ['System.Web.Mvc', 'System.Web.WebPages.Razor', 'System.Net.Http.Formatting', 'CrystalDecisions.Shared', 'Oracle.DataAccess']) {
    assert.equal(isFrameworkAssembly(name), false, name);
  }
});
