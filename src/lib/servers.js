// The server versions offered in the form (SQL Server, Windows Server).
//
// endoflife.date lists SQL Server per service pack ("13.0-sp3", label "2016 SP3") and
// Windows Server per channel, including the short-lived semi-annual ones. A company owner
// knows "we run SQL Server 2016", not which SP, so the form offers one entry per product
// generation, pointing at the cycle that is supported longest — the final service pack.
// The report says so in a note, because an older service pack lost support earlier.

/** "2008 R2 'Kilimanjaro' SP3" → "2008 R2 SP3"; "Windows Server 2012 R2 (LTSC)" → "2012 R2". */
export function cleanServerLabel(label) {
  return String(label ?? '')
    .replace(/'[^']*'/g, ' ')
    .replace(/^\s*(?:Microsoft\s+)?(?:SQL|Windows)\s+Server\s+/i, '')
    .replace(/\((?:LTSC|LTS)\)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "2016 SP3" → "SP3"; "2012 R2" → null. */
export function servicePackOf(label) {
  return /\bSP\d+\w*\b/i.exec(cleanServerLabel(label))?.[0].toUpperCase() ?? null;
}

const generationOf = (label) => cleanServerLabel(label).replace(/\s+SP\d+\w*$/i, '');

// Sort key for "supported until": no end announced sorts last, "ended, date unknown" first.
const endKey = (cycle) => (cycle.eol === false ? '9999-12-31' : cycle.eol === true ? '0000-00-00' : String(cycle.eol));

/**
 * @param {{cycles: Array<{name: string, label: string, eol: string|boolean, releaseDate: string|null}>}} product
 * @returns {Array<{ value: string, label: string }>} newest generation first
 */
export function serverOptions(product) {
  const generations = new Map();
  for (const cycle of product?.cycles ?? []) {
    // Semi-annual and annual channels (Windows Server 1809, 20H2, 23H2) and add-on packs
    // ("Azure Connect Pack") are not what a company means by "our server version".
    if (/-(?:sac|ac|acp)$/i.test(cycle.name) || /azure connect/i.test(cycle.label ?? '')) continue;
    const generation = generationOf(cycle.label || cycle.name);
    if (!generation) continue;
    const entry = generations.get(generation) ?? { cycle, first: cycle.releaseDate ?? '' };
    if (endKey(cycle) > endKey(entry.cycle)) entry.cycle = cycle;
    // Generations are ordered by their first release: 2016 SP3 shipped after 2019 RTM.
    if (cycle.releaseDate && (!entry.first || cycle.releaseDate < entry.first)) entry.first = cycle.releaseDate;
    generations.set(generation, entry);
  }
  return [...generations]
    .sort(([, a], [, b]) => b.first.localeCompare(a.first))
    .map(([generation, { cycle }]) => ({ value: cycle.name, label: generation }));
}
