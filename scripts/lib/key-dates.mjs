// The table of key support dates that scripts/update-eol.mjs prints for human review: in
// the log of the monthly data refresh and in its run summary. It lists the platform
// versions that legacy systems most often run on, which are also the ones the report is
// most likely to show.
//
// The table is printed, never asserted — endoflife.date is the authority — so a name that
// matches no cycle would drop its row without any error. test/eol-data.test.mjs guards
// against that: it fails when one of the products below has no row in the table built
// from data/eol.json, or when a name below matches no cycle in it.
//
// Names are matched exactly, as data/eol.json spells them (endoflife.date's release
// names), not as a person would say them: SQL Server is "13.0-sp3", not "2016", and
// Windows Server 2012 R2 is lower case, "2012-r2".

export const KEY_DATES = [
  ['dotnetfx', ['4.5.2', '4.6', '4.6.1', '4.6.2', '4.8']],
  ['dotnet', ['6', '8', '9', '10']],
  // SQL Server cycles are named by the engine's internal version and service pack
  // ("13.0-sp3", label "2016 SP3"): 12.0 is 2014, 13.0 is 2016, 14.0 is 2017, 15.0 is 2019.
  // One cycle per release: the final service pack, because an older one lost support
  // earlier (2017 and 2019 have none). endoflife.date lists 2016 SP3 twice, as "13.0-sp3"
  // and as "13.0-sp3-acp" ("2016 SP3 Azure Connect Pack"), an add-on pack of the same
  // release with the same dates; the plain service pack is the one listed here, as in
  // serverOptions() (src/lib/servers.js), which skips add-on packs too.
  ['mssqlserver', ['12.0-sp3', '13.0-sp3', '14.0', '15.0']],
  ['windows-server', ['2012', '2012-r2', '2016', '2019']],
  ['php', ['7.4', '8.1', '8.2']],
];

const HEADER = ['| product | cycle | end of support (eol) | extended/ESU (eoes) |', '|---|---|---|---|'];

/**
 * The key-dates table as Markdown: the header, then one row for each cycle named in
 * KEY_DATES that exists in `products`, in the order the data lists the cycles.
 *
 * @param {Record<string, { cycles: Array<{ name: string, label: string, eol: string | boolean, eoes: string | boolean | null }> }>} products
 *   the `products` object of data/eol.json
 * @returns {string}
 */
export function keyDatesTable(products) {
  const rows = [];
  for (const [id, names] of KEY_DATES) {
    for (const c of products[id]?.cycles ?? []) {
      if (names.includes(c.name)) rows.push(`| ${id} | ${c.label} | ${c.eol} | ${c.eoes ?? '—'} |`);
    }
  }
  return [...HEADER, ...rows].join('\n');
}
