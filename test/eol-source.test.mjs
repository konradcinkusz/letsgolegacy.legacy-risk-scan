import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeV0, normalizeV1, PRODUCTS, sameContent, SourceShapeError, validateDataset } from '../scripts/lib/eol-source.mjs';
import { fixtureJson } from './helpers.mjs';

test('API v1: dates where given, flags otherwise, extended support only where the product has it', () => {
  const { cycles, api } = normalizeV1('windows-server', fixtureJson('endoflife/v1-windows-server.json'));
  assert.equal(api, 'v1');
  assert.deepEqual(cycles[1], {
    name: '2012-r2',
    label: '2012 R2',
    releaseDate: '2013-10-18',
    lts: true,
    eoas: '2018-10-09',
    eol: '2023-10-10',
    eoes: '2026-10-13',
    latest: null,
  });
  assert.equal(cycles[0].eol, '2034-11-14');
  assert.equal(cycles[0].latest, '10.0.26100');
  assert.equal(cycles[2].eol, true, 'ended, no date known');
  assert.equal(cycles[2].eoes, null, 'no extended-support fields → not applicable');
});

test('API v1: an unexpected shape is refused, not guessed at', () => {
  assert.throws(() => normalizeV1('php', { result: { releases: [] } }), SourceShapeError);
  assert.throws(() => normalizeV1('php', { result: { releases: [{ name: '8.4' }] } }), SourceShapeError);
  assert.throws(() => normalizeV1('php', []), SourceShapeError);
});

test('API v0 fallback: "support: true" means still supported, i.e. active support has not ended', () => {
  const { cycles, api } = normalizeV0('php', fixtureJson('endoflife/v0-php.json'));
  assert.equal(api, 'v0');
  const byName = Object.fromEntries(cycles.map((c) => [c.name, c]));
  assert.equal(byName['7.1'].eol, '2019-12-01');
  assert.equal(byName['7.1'].eoas, '2018-12-01');
  assert.equal(byName['5.2'].eol, true);
  assert.equal(byName['5.2'].eoas, true, 'support: false → active support has ended');
  assert.equal(byName['9.0'].eol, false);
  assert.equal(byName['9.0'].eoas, false, 'support: true → active support has not ended');
  assert.throws(() => normalizeV0('php', [{ cycle: '1', eol: 'soon' }]), SourceShapeError);
});

function completeDataset() {
  const base = fixtureJson('eol.fixture.json');
  const cycle = (name, eol = false) => ({ name, label: name, releaseDate: null, lts: false, eoas: null, eol, eoes: null, latest: null });
  base.products.angular = { label: 'Angular', link: '', cycles: [cycle('12', '2022-11-12')] };
  base.products.symfony = { label: 'Symfony', link: '', cycles: [cycle('4.4', '2023-11-30')] };
  base.products.laravel.cycles.push(cycle('8', '2023-01-24'));
  base.products.nodejs.cycles.push(cycle('20', '2026-04-30'), cycle('14', '2023-04-30'));
  base.products.dotnetfx.cycles = base.products.dotnetfx.cycles.filter((c) => c.name !== '4.6.2');
  base.products.dotnetfx.cycles.push(cycle('4.6.2', '2027-01-12'));
  base.products.php.cycles.push(cycle('8.1', '2025-12-31'));
  return base;
}

test('validation passes a complete dataset', () => {
  assert.deepEqual(validateDataset(completeDataset()), []);
});

test('validation catches a missing product, a malformed date and a version no cycle matches', () => {
  const data = completeDataset();
  delete data.products.symfony;
  data.products.php.cycles[0].eol = '31.12.2028';
  data.products.dotnet.cycles = data.products.dotnet.cycles.filter((c) => c.name !== '8');
  const problems = validateDataset(data);
  assert.ok(problems.includes('symfony: missing'));
  assert.ok(problems.some((p) => p.startsWith('php[0] 8.4: eol')));
  assert.ok(problems.includes('dotnet: no release cycle matches 8.0'));
});

test('optional products may be absent; required ones are the ones the page depends on', () => {
  const data = completeDataset();
  delete data.products.jquery;
  assert.deepEqual(validateDataset(data), []);
  assert.deepEqual(PRODUCTS.filter((p) => !p.required).map((p) => p.id), ['jquery', 'bootstrap']);
});

test('content comparison ignores only the fetch date', () => {
  const a = completeDataset();
  const b = { ...structuredClone(a), generatedAt: '2030-01-01' };
  assert.equal(sameContent(a, b), true);
  b.products.php.cycles[0].eol = '2029-12-31';
  assert.equal(sameContent(a, b), false);
  assert.equal(sameContent(null, a), false);
});
