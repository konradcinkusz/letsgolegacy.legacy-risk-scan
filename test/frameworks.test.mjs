import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTargetFramework, splitFrameworks } from '../src/lib/frameworks.js';

const cases = [
  // value, product, version, label
  ['v4.5.1', 'dotnetfx', '4.5.1', '.NET Framework 4.5.1'],
  ['v4.0', 'dotnetfx', '4.0', '.NET Framework 4.0'],
  ['v3.5', 'dotnetfx', '3.5', '.NET Framework 3.5'],
  ['net45', 'dotnetfx', '4.5', '.NET Framework 4.5'],
  ['net451', 'dotnetfx', '4.5.1', '.NET Framework 4.5.1'],
  ['net48', 'dotnetfx', '4.8', '.NET Framework 4.8'],
  ['net481', 'dotnetfx', '4.8.1', '.NET Framework 4.8.1'],
  ['net40-client', 'dotnetfx', '4.0', '.NET Framework 4.0'],
  ['net403', 'dotnetfx', '4.0.3', '.NET Framework 4.0.3'],
  ['net20', 'dotnetfx', '2.0', '.NET Framework 2.0'],
  ['.NETFramework,Version=v4.7.2', 'dotnetfx', '4.7.2', '.NET Framework 4.7.2'],
  ['netcoreapp3.1', 'dotnet', '3.1', '.NET Core 3.1'],
  ['netcoreapp2.1', 'dotnet', '2.1', '.NET Core 2.1'],
  ['net5.0', 'dotnet', '5.0', '.NET 5'],
  ['net6.0', 'dotnet', '6.0', '.NET 6'],
  ['net8.0-windows', 'dotnet', '8.0', '.NET 8'],
  ['net9.0-windows10.0.19041.0', 'dotnet', '9.0', '.NET 9'],
  ['NET10.0', 'dotnet', '10.0', '.NET 10'],
  ['netstandard2.0', 'netstandard', '2.0', '.NET Standard 2.0'],
  ['uap10.0', null, null, 'uap10.0'],
  ['$(TargetFrameworks)', null, null, '$(TargetFrameworks)'],
];

for (const [value, product, version, label] of cases) {
  test(`target framework "${value}"`, () => {
    const r = parseTargetFramework(value);
    assert.equal(r.product, product);
    assert.equal(r.version, version);
    assert.equal(r.label, label);
  });
}

test('unrecognised and unresolved frameworks carry a reason', () => {
  assert.equal(parseTargetFramework('sl5').reason, 'unsupported-framework');
  assert.equal(parseTargetFramework('$(Tfm)').reason, 'unresolved-property');
  assert.equal(parseTargetFramework('  '), null);
});

test('TargetFrameworks is split on semicolons', () => {
  assert.deepEqual(splitFrameworks(' net48; net8.0 ;;netstandard2.0'), ['net48', 'net8.0', 'netstandard2.0']);
});
