import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMonthsIso, assessCycle, assessVersion, cycleStatus, findCycle, todayIso } from '../src/lib/eol.js';
import { fixtureJson } from './helpers.mjs';

const data = fixtureJson('eol.fixture.json');
const TODAY = '2026-09-26';

const cases = [
  // product, version, status, eolDate, cycle
  ['dotnetfx', '4.5.1', 'eol', '2016-01-12', '4.5.1'],
  ['dotnetfx', '4.0', 'eol', '2016-01-12', '4'],
  ['dotnetfx', '4.6.2', 'eol-soon', '2027-01-12', '4.6.2'],
  ['dotnetfx', '4.8', 'supported', null, '4.8'],
  ['dotnetfx', '4.8.1', 'supported', null, '4.8.1'],
  ['dotnet', '6.0', 'eol', '2024-11-12', '6'],
  ['dotnet', '8.0', 'eol-soon', '2026-11-10', '8'],
  ['dotnet', '9.0', 'eol-soon', '2026-11-10', '9'],
  ['dotnet', '10.0', 'supported', '2028-11-14', '10'],
  ['dotnet', '3.1', 'eol', '2022-12-13', '3.1'],
  ['php', '7.1.3', 'eol', '2019-12-01', '7.1'],
  ['php', '8.2.0', 'eol-soon', '2026-12-31', '8.2'],
  ['nodejs', '10.0.0', 'eol', '2021-04-30', '10'],
  ['jquery', '1.10.2', 'eol', null, '1'],
  ['jquery', '3.4.1', 'supported', null, '3'],
  ['laravel', '5.6.0', 'eol', '2019-02-07', '5.6'],
];

for (const [product, version, status, eolDate, cycle] of cases) {
  test(`${product} ${version} → ${status}`, () => {
    const r = assessVersion(data, product, version, TODAY);
    assert.equal(r.status, status);
    assert.equal(r.eolDate, eolDate);
    assert.equal(r.cycle, cycle);
  });
}

test('the longest matching cycle wins ("4.8.1" is not reported as "4.8")', () => {
  assert.equal(findCycle(data.products.dotnetfx, '4.8.1').cycle.name, '4.8.1');
  assert.equal(findCycle(data.products.dotnetfx, '4.8').cycle.name, '4.8');
  assert.equal(findCycle(data.products.nodejs, '15.2.0'), null, 'between cycles, and "1" is not a prefix of "10"');
  assert.equal(findCycle(data.products.nodejs, '1.0.0').match, 'older-than-tracked');
});

test('a short cycle name with more specific siblings means its .0 release ("4" is .NET Framework 4.0)', () => {
  assert.equal(findCycle(data.products.dotnetfx, '4.0').cycle.name, '4');
  assert.equal(findCycle(data.products.dotnetfx, '4.0.3').cycle.name, '4');
  assert.equal(findCycle(data.products.dotnetfx, '4.7.2'), null);
  assert.equal(findCycle(data.products.jquery, '3.4.1').cycle.name, '3', 'without siblings "3" covers all of 3.x');
});

test('a version older than every tracked cycle is past its end of life', () => {
  const r = assessVersion(data, 'dotnetfx', '3.5', TODAY);
  assert.equal(r.status, 'eol');
  assert.equal(r.match, 'older-than-tracked');
  assert.equal(r.olderThanDate, '2016-01-12');
});

test('a version between tracked cycles has no data rather than a guess', () => {
  assert.equal(assessVersion(data, 'dotnetfx', '4.7.2', TODAY).status, 'no-data');
});

test('an untracked product returns null; an unavailable one too', () => {
  assert.equal(assessVersion(data, 'bootstrap', '3.0.0', TODAY), null);
  assert.equal(assessVersion(data, 'nope', '1.0', TODAY), null);
});

test('status is computed on the day of the report: the end date itself counts as ended', () => {
  const dotnet8 = data.products.dotnet.cycles.find((c) => c.name === '8');
  assert.equal(cycleStatus(dotnet8, '2026-11-09').status, 'eol-soon');
  assert.equal(cycleStatus(dotnet8, '2026-11-10').status, 'eol');
  assert.equal(cycleStatus(dotnet8, '2025-11-09').status, 'supported', 'more than 12 months ahead');
  assert.equal(cycleStatus(dotnet8, '2025-11-10').status, 'eol-soon', 'exactly 12 months ahead');
});

test('extended security updates and security-only phases are carried through', () => {
  const ws = assessCycle(data, 'windows-server', '2012-r2', TODAY);
  assert.equal(ws.status, 'eol');
  assert.equal(ws.eolDate, '2023-10-10');
  assert.equal(ws.eoesDate, '2026-10-13');
  assert.equal(ws.cycleLabel, '2012 R2');
  const sql = assessCycle(data, 'mssqlserver', '2016', TODAY);
  assert.equal(sql.status, 'eol');
  assert.equal(sql.eolDate, '2026-07-14');
  const php = assessVersion(data, 'php', '8.2.0', TODAY);
  assert.equal(php.eoasPassed, true);
  assert.equal(php.eoasDate, '2024-12-31');
  assert.equal(assessCycle(data, 'mssqlserver', '2000', TODAY), null);
});

test('calendar arithmetic', () => {
  assert.equal(addMonthsIso('2026-09-26', 12), '2027-09-26');
  assert.equal(addMonthsIso('2028-02-29', 12), '2029-02-28');
  assert.equal(addMonthsIso('2026-12-31', 2), '2027-02-28');
  assert.equal(todayIso(new Date(2026, 0, 5)), '2026-01-05');
});
