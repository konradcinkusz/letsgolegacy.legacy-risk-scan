// The key-dates table of the data refresh (scripts/lib/key-dates.mjs), run over a small
// fixture in the shape of data/eol.json's "products". Names and labels are the ones
// endoflife.date uses, which is the point: SQL Server cycles are "13.0-sp3", not "2016".
// The dates are illustrative. The committed data is checked in eol-data.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyDatesTable } from '../scripts/lib/key-dates.mjs';

const HEADER = ['| product | cycle | end of support (eol) | extended/ESU (eoes) |', '|---|---|---|---|'];

const cycle = (name, label, eol, eoes = null) => ({ name, label, releaseDate: null, lts: false, eoas: null, eol, eoes, latest: null });
const product = (label, ...cycles) => ({ label, link: '', cycles });

// Cycles are listed the way the data lists them: by release date, newest first.
const products = {
  dotnetfx: product('.NET Framework', cycle('4.8.1', '4.8.1', false), cycle('4.8', '4.8', false), cycle('4.6.2', '4.6.2', '2027-01-12'), cycle('4.5.1', '4.5.1', '2016-01-12')),
  dotnet: product('.NET', cycle('10', '10 (LTS)', '2028-11-14'), cycle('7', '7', '2024-05-14'), cycle('6', '6 (LTS)', '2024-11-12')),
  mssqlserver: product(
    'Microsoft SQL Server',
    cycle('17.0', '2025', '2036-01-06'),
    cycle('16.0', "2022 'Dallas'", '2033-01-11'),
    cycle('13.0-sp3-acp', '2016 SP3 Azure Connect Pack', '2026-07-14', '2029-07-17'),
    cycle('13.0-sp3', '2016 SP3', '2026-07-14', '2029-07-17'),
    cycle('15.0', "2019 'Aris/Seattle'", '2030-01-08'),
    cycle('12.0-sp3', "2014 'Hekaton' SP3", '2024-07-09', '2027-07-12'),
    cycle('13.0-sp2', '2016 SP2', '2022-10-11'),
    cycle('14.0', "2017 'Helsinki'", '2027-10-12'),
    cycle('12.0', "2014 'Hekaton'", '2016-07-12'),
  ),
  'windows-server': product(
    'Windows Server',
    cycle('2025', 'Windows Server 2025 (LTSC)', '2034-11-14'),
    cycle('2019', 'Windows Server 2019 (LTSC)', '2029-01-09'),
    cycle('2016', 'Windows Server 2016 (LTSC)', '2027-01-12', '2030-01-12'),
    cycle('2012-r2', 'Windows Server 2012 R2 (LTSC)', '2023-10-10', '2026-10-13'),
    cycle('2012', 'Windows Server 2012 (LTSC)', '2023-10-10', '2026-10-13'),
    cycle('2008-r2-sp1', 'Windows Server 2008 R2 SP1 (LTSC)', '2020-01-14', '2023-01-10'),
  ),
  php: product('PHP', cycle('8.4', '8.4', '2028-12-31'), cycle('8.2', '8.2', '2026-12-31'), cycle('8.1', '8.1', '2025-12-31'), cycle('7.4', '7.4', '2022-11-28'), cycle('7.3', '7.3', '2021-12-06')),
};

const rowsOf = (table, id) => table.split('\n').filter((line) => line.startsWith(`| ${id} |`));

test('the table is a header and one row for each selected cycle, in the order the data lists them', () => {
  assert.deepEqual(keyDatesTable(products).split('\n'), [
    ...HEADER,
    '| dotnetfx | 4.8 | false | — |',
    '| dotnetfx | 4.6.2 | 2027-01-12 | — |',
    '| dotnet | 10 (LTS) | 2028-11-14 | — |',
    '| dotnet | 6 (LTS) | 2024-11-12 | — |',
    '| mssqlserver | 2016 SP3 | 2026-07-14 | 2029-07-17 |',
    "| mssqlserver | 2019 'Aris/Seattle' | 2030-01-08 | — |",
    "| mssqlserver | 2014 'Hekaton' SP3 | 2024-07-09 | 2027-07-12 |",
    "| mssqlserver | 2017 'Helsinki' | 2027-10-12 | — |",
    '| windows-server | Windows Server 2019 (LTSC) | 2029-01-09 | — |',
    '| windows-server | Windows Server 2016 (LTSC) | 2027-01-12 | 2030-01-12 |',
    '| windows-server | Windows Server 2012 R2 (LTSC) | 2023-10-10 | 2026-10-13 |',
    '| windows-server | Windows Server 2012 (LTSC) | 2023-10-10 | 2026-10-13 |',
    '| php | 8.2 | 2026-12-31 | — |',
    '| php | 8.1 | 2025-12-31 | — |',
    '| php | 7.4 | 2022-11-28 | — |',
  ]);
});

test('SQL Server: one row each for 2014, 2016, 2017 and 2019, found by cycle name and not by year', () => {
  const labels = rowsOf(keyDatesTable(products), 'mssqlserver').map((line) => line.slice(2, -2).split(' | ')[1]);
  // The fixture also holds the Azure Connect Pack variant of 2016 SP3, an older service pack
  // of 2016, the original 2014 release and two releases outside the list (2022, 2025).
  assert.deepEqual(labels.sort(), ["2014 'Hekaton' SP3", '2016 SP3', "2017 'Helsinki'", "2019 'Aris/Seattle'"]);
});

test('a product the data does not have is skipped', () => {
  assert.deepEqual(keyDatesTable({}).split('\n'), HEADER);
  assert.equal(rowsOf(keyDatesTable({ php: products.php }), 'php').length, 3);
});
