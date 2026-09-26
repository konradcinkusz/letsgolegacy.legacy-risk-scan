import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareVersions,
  lowestVersion,
  normalizeNuGetVersion,
  nugetLowest,
  numericParts,
} from '../src/lib/versions.js';

const composer = [
  // constraint, version, kind, reason
  ['^7.1.3', '7.1.3', 'lowest'],
  ['5.6.*', '5.6.0', 'lowest'],
  ['~6.0', '6.0.0', 'lowest'],
  ['1.2.3', '1.2.3', 'exact'],
  ['v2.8.0', '2.8.0', 'exact'],
  ['>=1.2 <2.0', '1.2.0', 'lowest'],
  ['>= 1.2, < 2.0', '1.2.0', 'lowest'],
  ['>1.2 >=1.5', '1.5.0', 'lowest'],
  ['^1.23 || ^2.0', '1.23.0', 'lowest'],
  ['^7.3|^8.0', '7.3.0', 'lowest'],
  ['1.0 - 2.0', '1.0.0', 'lowest'],
  ['^2.0@dev', '2.0.0', 'lowest'],
  ['^2.0 || dev-main', '2.0.0', 'lowest'],
  ['2.0.0-beta1', '2.0.0-beta1', 'exact'],
  ['dev-master', null, 'unknown', 'dev-branch'],
  ['1.0.x-dev', null, 'unknown', 'dev-branch'],
  ['*', null, 'unknown', 'no-lower-bound'],
  ['<2.0', null, 'unknown', 'no-lower-bound'],
  ['>4.0', null, 'unknown', 'exclusive-lower-bound'],
  ['^1.0 || <0.5', null, 'unknown', 'no-lower-bound'],
  ['self.version', null, 'unknown', 'unparseable'],
];

for (const [constraint, version, kind, reason] of composer) {
  test(`composer: lowest version for "${constraint}"`, () => {
    const r = lowestVersion(constraint, 'composer');
    assert.equal(r.version, version);
    assert.equal(r.kind, kind);
    if (reason) assert.equal(r.reason, reason);
  });
}

const npm = [
  ['^4.17.21', '4.17.21', 'lowest'],
  ['~8.2.14', '8.2.14', 'lowest'],
  ['1.5.8', '1.5.8', 'exact'],
  ['1.x', '1.0.0', 'lowest'],
  ['>=4.0.0 <5.0.0', '4.0.0', 'lowest'],
  ['^1.0.0 || ^2.0.0', '1.0.0', 'lowest'],
  ['>=1.0.0-beta.1', '1.0.0-beta.1', 'lowest'],
  ['latest', null, 'unknown', 'dist-tag'],
  ['file:../lib', null, 'unknown', 'non-registry'],
  ['github:owner/repo', null, 'unknown', 'non-registry'],
  ['owner/repo#main', null, 'unknown', 'non-registry'],
  ['git+https://example.invalid/x.git', null, 'unknown', 'non-registry'],
  ['*', null, 'unknown', 'no-lower-bound'],
  ['', null, 'unknown', 'no-lower-bound'],
];

for (const [constraint, version, kind, reason] of npm) {
  test(`npm: lowest version for "${constraint}"`, () => {
    const r = lowestVersion(constraint, 'npm');
    assert.equal(r.version, version);
    assert.equal(r.kind, kind);
    if (reason) assert.equal(r.reason, reason);
  });
}

const nuget = [
  ['6.0.4', '6.0.4', 'exact'],
  ['1.0.0.0', '1.0.0', 'exact'],
  ['3.4.1.9004', '3.4.1.9004', 'exact'],
  ['[1.0]', '1.0.0', 'exact'],
  ['[1.0,2.0)', '1.0.0', 'lowest'],
  ['[1.0,)', '1.0.0', 'lowest'],
  ['(1.0,)', null, 'unknown', 'exclusive-lower-bound'],
  ['(,2.0]', null, 'unknown', 'no-lower-bound'],
  ['12.*', null, 'unknown', 'floating'],
  ['$(PollyVersion)', null, 'unknown', 'unresolved-property'],
  ['', null, 'unknown', 'not-specified'],
  ['6.0.4-beta1', '6.0.4-beta1', 'exact'],
  ['latest', null, 'unknown', 'unparseable'],
];

for (const [spec, version, kind, reason] of nuget) {
  test(`NuGet: version to check for "${spec}"`, () => {
    const r = nugetLowest(spec);
    assert.equal(r.version, version);
    assert.equal(r.kind, kind);
    if (reason) assert.equal(r.reason, reason);
  });
}

test('NuGet normalisation drops a zero fourth part and leading zeros', () => {
  assert.equal(normalizeNuGetVersion('1.0'), '1.0.0');
  assert.equal(normalizeNuGetVersion('1.01.2'), '1.1.2');
  assert.equal(normalizeNuGetVersion('4.0.30319.1'), '4.0.30319.1');
  assert.equal(normalizeNuGetVersion('1.0.0+build.5'), '1.0.0');
  assert.equal(normalizeNuGetVersion('abc'), null);
});

test('version comparison: numeric parts, then pre-release before release', () => {
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('2.0', '2.0.0'), 0);
  assert.equal(compareVersions('1.0.0-beta', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1);
  assert.equal(compareVersions('v3.5.0', '3.5.0'), 0);
});

test('numeric parts tolerate prefixes and suffixes that name release cycles', () => {
  assert.deepEqual(numericParts('4.5.1'), [4, 5, 1]);
  assert.deepEqual(numericParts('v4.0'), [4, 0]);
  assert.deepEqual(numericParts('3.5 SP1'), [3, 5]);
  assert.deepEqual(numericParts('2012-r2'), [2012]);
  assert.equal(numericParts('R2'), null);
});
