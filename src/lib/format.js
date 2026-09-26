// Polish formatting: dates, relative time and plural forms.

const DATE_FORMAT = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const RELATIVE = new Intl.RelativeTimeFormat('pl', { numeric: 'always' });
const PLURAL = new Intl.PluralRules('pl-PL');

const toUtc = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** "2016-01-12" → "12 stycznia 2016". Anything that is not an ISO date is returned as is. */
export function formatDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return String(iso ?? '');
  return DATE_FORMAT.format(new Date(toUtc(iso)));
}

/** Distance from `today` in words: "10 lat temu", "za 45 dni", "za 3 miesiące". */
export function relativeToToday(iso, today) {
  const days = Math.round((toUtc(iso) - toUtc(today)) / 86_400_000);
  const abs = Math.abs(days);
  if (abs < 60) return RELATIVE.format(days, 'day');
  if (abs < 730) return RELATIVE.format(Math.trunc(days / 30.44), 'month');
  return RELATIVE.format(Math.trunc(days / 365.25), 'year');
}

/**
 * Polish plural form: plural(n, ['pozycja', 'pozycje', 'pozycji']) — one, few, many.
 * @param {number} n
 * @param {[string, string, string]} forms
 */
export function plural(n, [one, few, many]) {
  const category = PLURAL.select(n);
  if (category === 'one') return one;
  if (category === 'few') return few;
  return many;
}
