import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest, MAX_INPUT_CHARS, jsonErrorPosition } from '../src/lib/manifest.js';
import { ScanError } from '../src/lib/errors.js';
import { fixture, sample } from './helpers.mjs';

const code = (input) => {
  try {
    parseManifest(input);
    return null;
  } catch (e) {
    assert.ok(e instanceof ScanError, `expected a ScanError, got ${e}`);
    return e.code;
  }
};

test('format detection', () => {
  assert.equal(parseManifest(sample('Sklep.Legacy.csproj')).format, 'msbuild-legacy');
  assert.equal(parseManifest(fixture('manifests/Sdk.Multi.csproj')).format, 'msbuild-sdk');
  assert.equal(parseManifest(fixture('manifests/packages.config')).format, 'packages-config');
  assert.equal(parseManifest(fixture('manifests/composer.json')).format, 'composer-json');
  assert.equal(parseManifest(fixture('manifests/composer.lock')).format, 'composer-lock');
  assert.equal(parseManifest(fixture('manifests/package.json')).format, 'package-json');
  assert.equal(parseManifest(`﻿${fixture('manifests/package.json')}`).format, 'package-json', 'a BOM is tolerated');
});

const errors = [
  ['empty input', '', 'EMPTY_INPUT'],
  ['whitespace only', '  \n\t ', 'EMPTY_INPUT'],
  ['plain text', 'Newtonsoft.Json 6.0.4', 'UNKNOWN_FORMAT'],
  ['a solution file', 'Microsoft Visual Studio Solution File, Format Version 12.00\n# Visual Studio 2013', 'SOLUTION_FILE'],
  ['a web.config', '<?xml version="1.0"?><configuration><appSettings/></configuration>', 'XML_CONFIG_FILE'],
  ['some other XML', '<html><body/></html>', 'XML_UNSUPPORTED_ROOT'],
  ['a JSON array', '[1, 2, 3]', 'JSON_UNSUPPORTED'],
  ['JSON without dependencies', '{"name": "x", "version": "1.0.0"}', 'JSON_UNSUPPORTED'],
  ['package-lock.json', '{"name": "x", "lockfileVersion": 3, "packages": {}}', 'PACKAGE_LOCK_UNSUPPORTED'],
  ['composer.json with a malformed require', '{"require": "laravel/framework"}', 'MANIFEST_INVALID'],
  ['composer.lock with a malformed packages list', '{"content-hash": "x", "packages": {"a": 1}}', 'MANIFEST_INVALID'],
];

for (const [name, input, expected] of errors) {
  test(`clear error for ${name}`, () => assert.equal(code(input), expected));
}

test('oversized input is refused before parsing', () => {
  assert.equal(code(`<Project>${' '.repeat(MAX_INPUT_CHARS)}</Project>`), 'INPUT_TOO_LARGE');
});

test('a truncated project file reports where it breaks', () => {
  const text = sample('Sklep.Legacy.csproj');
  const cut = text.slice(0, text.indexOf('<Reference Include="Newtonsoft.Json'));
  try {
    parseManifest(cut);
    assert.fail('expected an error');
  } catch (e) {
    assert.equal(e.code, 'XML_MALFORMED');
    assert.equal(e.params.reason, 'unclosed-tag');
    assert.ok(e.params.line > 1);
  }
});

test('a truncated JSON file reports a line and column when the engine gives a position', () => {
  const text = fixture('manifests/composer.json');
  try {
    parseManifest(text.slice(0, text.indexOf('"require-dev"')));
    assert.fail('expected an error');
  } catch (e) {
    assert.equal(e.code, 'JSON_MALFORMED');
    assert.ok(e.params.line >= 1, 'line derived from the parser message');
  }
});

test('JSON error positions across engines', () => {
  const text = '{\n  "a": 1\n  "b": 2\n}';
  assert.deepEqual(jsonErrorPosition('Unexpected string in JSON at position 13', text), { line: 3, column: 3 });
  assert.deepEqual(
    jsonErrorPosition("JSON.parse: expected ',' or '}' after property value in object at line 3 column 3 of the JSON data", text),
    { line: 3, column: 3 },
  );
  assert.equal(jsonErrorPosition('JSON Parse error: Expected }', text), null);
});

test('never crashes: every truncation of every supported file parses or fails with a ScanError', () => {
  const inputs = [
    sample('Sklep.Legacy.csproj'),
    fixture('manifests/Sdk.Multi.csproj'),
    fixture('manifests/Directory.Packages.props'),
    fixture('manifests/packages.config'),
    fixture('manifests/composer.json'),
    fixture('manifests/composer.lock'),
    fixture('manifests/package.json'),
  ];
  let checked = 0;
  for (const text of inputs) {
    const step = Math.max(1, Math.floor(text.length / 150));
    for (let end = 1; end < text.length; end += step) {
      for (const candidate of [text.slice(0, end), text.slice(end)]) {
        try {
          parseManifest(candidate);
        } catch (e) {
          assert.ok(e instanceof ScanError, `non-ScanError ${e?.name}: ${e?.message} for input ending …${candidate.slice(-40)}`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 1500);
});
