import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanServerLabel, serverOptions, servicePackOf } from '../src/lib/servers.js';

const cycle = (name, label, releaseDate, eol) => ({ name, label, releaseDate, eol });

test('labels lose codenames, product prefixes and channel markers', () => {
  assert.equal(cleanServerLabel("2008 R2 'Kilimanjaro' SP3"), '2008 R2 SP3');
  assert.equal(cleanServerLabel("2022 'Dallas'"), '2022');
  assert.equal(cleanServerLabel('Windows Server 2012 R2 (LTSC)'), '2012 R2');
  assert.equal(servicePackOf("2014 'Hekaton' SP3"), 'SP3');
  assert.equal(servicePackOf('Windows Server 2012 R2 (LTSC)'), null);
});

test('one option per generation, pointing at its longest-supported service pack, newest generation first', () => {
  const product = {
    cycles: [
      cycle('15.0', "2019 'Aris'", '2019-11-04', '2030-01-08'),
      cycle('13.0-sp3-acp', '2016 SP3 Azure Connect Pack', '2022-05-19', '2026-07-14'),
      cycle('13.0-sp3', '2016 SP3', '2021-09-15', '2026-07-14'),
      cycle('13.0-sp2', '2016 SP2', '2018-04-24', '2022-10-11'),
      cycle('13.0', '2016', '2016-06-01', '2018-01-09'),
      cycle('10.50-r2', "2008 'Kilimanjaro' R2", '2010-07-20', '2012-07-10'),
      cycle('10.50-sp3', "2008 R2 'Kilimanjaro' SP3", '2014-07-07', '2019-07-09'),
    ],
  };
  assert.deepEqual(serverOptions(product), [
    { value: '15.0', label: '2019' },
    { value: '13.0-sp3', label: '2016' },
    { value: '10.50-sp3', label: '2008 R2' },
  ]);
});

test('semi-annual and annual Windows Server channels are not offered', () => {
  const product = {
    cycles: [
      cycle('2022', 'Windows Server 2022 (LTSC)', '2021-08-18', '2031-10-14'),
      cycle('23h2-ac', 'Windows Server 23H2 AC', '2023-10-24', '2026-05-12'),
      cycle('20h2-sac', 'Windows Server 20H2 SAC', '2020-10-20', '2022-08-09'),
      cycle('2012-r2', 'Windows Server 2012 R2 (LTSC)', '2013-11-25', '2023-10-10'),
    ],
  };
  assert.deepEqual(serverOptions(product).map((o) => o.label), ['2022', '2012 R2']);
});
