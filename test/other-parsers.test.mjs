import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseManifest } from '../src/lib/manifest.js';
import { fixture } from './helpers.mjs';

const find = (m, name) => m.packages.find((p) => p.name === name);

test('packages.config: exact versions, the newest .NET Framework among targetFramework values', () => {
  const m = parseManifest(fixture('manifests/packages.config'));
  assert.equal(m.format, 'packages-config');
  assert.equal(m.packages.length, 8);
  assert.equal(find(m, 'Newtonsoft.Json').version, '6.0.4');
  assert.equal(find(m, 'Antlr').version, '3.4.1.9004');
  assert.deepEqual(m.runtimes.map((r) => [r.product, r.version]), [['dotnetfx', '4.5.1']]);
  assert.ok(m.hints.some((h) => h.code === 'HINT_PACKAGES_CONFIG_FRAMEWORK'));
  assert.equal(find(m, 'Microsoft.CodeDom.Providers.DotNetCompilerPlatform').dev, true);
  assert.equal(find(m, 'jQuery').alsoNpm, 'jquery');
  assert.equal(find(m, 'bootstrap').alsoNpm, 'bootstrap');
});

test('composer.json: the php constraint becomes the minimum PHP version', () => {
  const m = parseManifest(fixture('manifests/composer.json'));
  assert.equal(m.format, 'composer-json');
  const [required, platform] = m.runtimes;
  assert.equal(required.product, 'php');
  assert.equal(required.version, '7.1.3');
  assert.equal(required.versionKind, 'lowest');
  assert.equal(required.spec, '^7.1.3');
  assert.equal(platform.origin, 'config.platform.php');
  assert.equal(platform.version, '7.1.33');
});

test('composer.json: constraints are checked at their lowest version, or marked unknown', () => {
  const m = parseManifest(fixture('manifests/composer.json'));
  const p = (name) => find(m, name);
  assert.equal(p('laravel/framework').version, '5.6.0');
  assert.equal(p('laravel/framework').versionKind, 'lowest');
  assert.equal(p('guzzlehttp/guzzle').version, '6.0.0');
  assert.equal(p('monolog/monolog').version, '1.23.0');
  assert.equal(p('firma/wewnetrzny-modul').reason, 'dev-branch');
  assert.equal(p('symfony/process').reason, 'exclusive-lower-bound');
  assert.equal(p('doctrine/dbal').version, '2.8.0', 'names are lower-cased; a v prefix is dropped');
  assert.equal(p('doctrine/dbal').versionKind, 'exact');
  assert.equal(p('phpunit/phpunit').dev, true);
  assert.equal(p('ext-mbstring'), undefined, 'platform requirements are not packages');
  assert.deepEqual(m.hints.find((h) => h.code === 'HINT_PLATFORM_PACKAGES').params.names, ['ext-mbstring', 'ext-pdo']);
  assert.ok(m.hints.some((h) => h.code === 'HINT_COMPOSER_CONSTRAINTS'));
});

test('composer.lock: exact versions, dev branches unknown, platform PHP', () => {
  const m = parseManifest(fixture('manifests/composer.lock'));
  assert.equal(m.format, 'composer-lock');
  assert.equal(find(m, 'laravel/framework').version, '5.6.39');
  assert.equal(find(m, 'laravel/framework').versionKind, 'exact');
  assert.equal(find(m, 'firma/wewnetrzny-modul').reason, 'dev-branch');
  assert.equal(find(m, 'phpunit/phpunit').dev, true);
  assert.deepEqual(m.runtimes.map((r) => [r.origin, r.version]), [['platform.php', '7.1.3'], ['platform-overrides.php', '7.1.33']]);
});

test('package.json: ranges at their lowest version, engines.node as the runtime', () => {
  const m = parseManifest(fixture('manifests/package.json'));
  assert.equal(m.format, 'package-json');
  assert.equal(find(m, 'angular').version, '1.5.8');
  assert.equal(find(m, '@angular/core').version, '8.2.14');
  assert.equal(find(m, 'jquery').version, '3.4.1');
  assert.equal(find(m, 'internal-lib').reason, 'non-registry');
  assert.equal(find(m, 'left-pad').reason, 'dist-tag');
  assert.equal(find(m, 'webpack').dev, true);
  assert.equal(find(m, 'webpack').version, '4.0.0');
  assert.deepEqual(m.runtimes.map((r) => [r.product, r.version]), [['nodejs', '10.0.0']]);
});
