// Report → DOM. Every node is created with textContent and setAttribute, never innerHTML:
// advisory summaries are third-party text and the pasted file is the visitor's own, so
// neither may ever be interpreted as markup.

import {
  ADVISORY_STATE_TEXT,
  BUSINESS_MEANING,
  FORMAT_LABELS,
  SEVERITY_LABELS,
  STATUS_LABELS,
  SUMMARY_LABELS,
  UI,
  attentionSentence,
  format,
  hintText,
  noteText,
  sourceText,
} from './lib/messages.js';
import { STATUS_ORDER } from './lib/report.js';
import { formatDate, relativeToToday } from './lib/format.js';

const VISIBLE_ADVISORIES = 3;

/** Minimal element builder: h('a', { href }, 'text', childNode, null, …). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false || child === '') continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const hidden = (text) => h('span', { class: 'visually-hidden' }, text);

function badges(item) {
  const list = [];
  if (item.flags.eol) list.push(['eol', STATUS_LABELS.eol]);
  if (item.flags.eolSoon) list.push(['eol-soon', STATUS_LABELS['eol-soon']]);
  if (item.flags.vulnerable) list.push(['vulnerable', format(UI.vulnerableCount, { count: item.advisories.length })]);
  if (!list.length) list.push([item.status, STATUS_LABELS[item.status]]);
  return h('span', { class: 'badges' }, list.map(([kind, text]) => h('span', { class: `badge badge-${kind}` }, text)));
}

function versionCell(item) {
  let main = item.version ?? '—';
  let detail = null;
  if (item.kind === 'runtime' && item.versionKind === 'lowest') {
    main = format(UI.atLeast, { version: item.version });
    detail = format(UI.constraint, { spec: item.spec });
  } else if (item.versionKind === 'lowest') {
    detail = format(UI.constraint, { spec: item.spec });
  } else if (!item.version && item.spec) {
    detail = item.source.origin === 'manual-dll' || item.source.origin === 'gac'
      ? format(UI.assemblyVersion, { version: item.spec })
      : item.spec;
  }
  return [main, detail ? h('span', { class: 'version-detail' }, detail) : null];
}

function eolCell(item, today) {
  const eol = item.eol;
  if (!eol) return [h('span', { 'aria-hidden': 'true' }, '—'), hidden(UI.notApplicable)];
  const source = h('a', { class: 'relative', href: eol.link }, UI.eolSource);
  if (eol.status === 'no-data') return [UI.eolNoData, source];
  if (eol.eolDate) {
    return [formatDate(eol.eolDate), h('span', { class: 'relative' }, relativeToToday(eol.eolDate, today)), source];
  }
  return [eol.status === 'eol' ? UI.eolEnded : UI.eolNotAnnounced, source];
}

function advisoryItem(a) {
  return h(
    'li',
    {},
    h(
      'a',
      { class: 'advisory-id', href: a.url, target: '_blank', rel: 'noopener noreferrer' },
      a.id,
      hidden(UI.newTab),
    ),
    a.severity ? h('span', { class: `severity severity-${a.severity}` }, hidden(UI.severity), SEVERITY_LABELS[a.severity]) : null,
    a.aliases.length ? h('span', { class: 'advisory-meta' }, a.aliases.join(', ')) : null,
    a.summary ? h('span', { class: 'advisory-summary', lang: 'en' }, a.summary) : null,
    a.fixed.length ? h('span', { class: 'advisory-fix' }, format(UI.fixedIn, { versions: a.fixed.join(', ') })) : null,
  );
}

function advisoriesCell(item) {
  if (item.advisoryState === 'not-applicable') return [h('span', { 'aria-hidden': 'true' }, '—'), hidden(UI.notApplicable)];
  if (item.advisoryState !== 'checked') return h('span', { class: 'muted' }, ADVISORY_STATE_TEXT[item.advisoryState]);
  if (!item.advisories.length) return ADVISORY_STATE_TEXT.none;
  const first = item.advisories.slice(0, VISIBLE_ADVISORIES);
  const rest = item.advisories.slice(VISIBLE_ADVISORIES);
  return [
    h('ul', { class: 'advisories' }, first.map(advisoryItem)),
    rest.length
      ? h(
          'details',
          { class: 'advisory-more' },
          h('summary', {}, format(UI.showMore, { count: rest.length })),
          h('ul', { class: 'advisories' }, rest.map(advisoryItem)),
        )
      : null,
  ];
}

function row(item, today) {
  const source = sourceText(item.source);
  const notes = item.notes.map(noteText).filter(Boolean);
  // Explicit roles keep the table a table for assistive technology after the narrow-screen
  // CSS turns rows into cards (some browsers drop table semantics on a display change).
  return h(
    'tr',
    { role: 'row', 'data-status': item.status, 'data-testid': 'report-row' },
    h(
      'th',
      { scope: 'row', role: 'rowheader' },
      h('span', { class: 'item-name' }, item.name),
      item.ecosystem ? h('span', { class: 'ecosystem' }, item.ecosystem) : null,
      source ? h('span', { class: 'source' }, source) : null,
      notes.length ? h('ul', { class: 'notes' }, notes.map((n) => h('li', {}, n))) : null,
    ),
    h('td', { role: 'cell', class: 'col-version', 'data-label': UI.columns.version }, versionCell(item)),
    h('td', { role: 'cell', class: 'col-status', 'data-label': UI.columns.status }, badges(item)),
    h('td', { role: 'cell', class: 'col-eol', 'data-label': UI.columns.eol }, eolCell(item, today)),
    h('td', { role: 'cell', class: 'col-advisories', 'data-label': UI.columns.advisories }, advisoriesCell(item)),
  );
}

function table(items, caption, today) {
  const cols = UI.columns;
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { role: 'table' },
      h('caption', {}, caption),
      h(
        'thead',
        { role: 'rowgroup' },
        h(
          'tr',
          { role: 'row' },
          [cols.name, cols.version, cols.status, cols.eol, cols.advisories].map((c) => h('th', { scope: 'col', role: 'columnheader' }, c)),
        ),
      ),
      h('tbody', { role: 'rowgroup' }, items.map((item) => row(item, today))),
    ),
  );
}

const SUMMARY_TILES = [
  ['eol', 'eol'],
  ['eolSoon', 'eol-soon'],
  ['vulnerable', 'vulnerable'],
  ['ok', 'ok'],
  ['unknown', 'unknown'],
];

const SUMMARY_KEY = { eol: 'eol', 'eol-soon': 'eolSoon', vulnerable: 'vulnerable', unknown: 'unknown', ok: 'ok' };

/** Items that need attention: past or near end of support, or with known advisories. */
export const attentionCount = (report) =>
  [...report.platform, ...report.dependencies].filter((i) => i.flags.eol || i.flags.eolSoon || i.flags.vulnerable).length;

/**
 * Fills the report section's containers.
 * @param {object} report from buildReport()
 * @param {Record<string, HTMLElement>} els the section's elements
 */
export function renderReport(report, els) {
  const today = report.today;
  const meta = [
    format(UI.metaFormat, { format: FORMAT_LABELS[report.format] ?? report.format }),
    report.dataDate ? format(UI.metaEol, { date: formatDate(report.dataDate) }) : UI.metaEolMissing,
    report.osvState === 'ok'
      ? format(UI.metaOsv, { date: formatDate(today) })
      : report.osvState === 'error'
        ? UI.metaOsvError
        : UI.metaOsvSkipped,
  ];
  els.meta.textContent = meta.join(' ');
  els.osvWarning.hidden = report.osvState !== 'error';

  const { summary } = report;
  els.summary.replaceChildren(
    ...SUMMARY_TILES.map(([key, kind]) =>
      h(
        'li',
        { class: `tile-${kind}`, 'data-testid': `summary-${kind}` },
        h('span', { class: 'count' }, summary[key]),
        h('span', { class: 'label' }, SUMMARY_LABELS[key]),
      ),
    ),
  );
  els.summaryNote.textContent = summary.total ? format(UI.summaryTotal, { count: summary.total }) : UI.emptyReport;
  els.attention.textContent = attentionSentence(attentionCount(report));

  els.meaning.replaceChildren(
    ...STATUS_ORDER.filter((status) => summary[SUMMARY_KEY[status]] > 0).map((status) =>
      h(
        'div',
        { class: `meaning-item meaning-${status}` },
        h('h4', {}, `${BUSINESS_MEANING[status].title} (${summary[SUMMARY_KEY[status]]})`),
        h('p', {}, BUSINESS_MEANING[status].text),
      ),
    ),
  );

  els.platform.replaceChildren(
    report.platform.length ? table(report.platform, UI.tablePlatform, today) : h('p', { class: 'empty' }, UI.emptyPlatform),
  );
  els.dependencies.replaceChildren(
    report.dependencies.length
      ? table(report.dependencies, format(UI.tableDependencies, { count: report.dependencies.length }), today)
      : h('p', { class: 'empty' }, UI.emptyDependencies),
  );

  const hints = report.hints.map(hintText).filter(Boolean);
  els.hints.replaceChildren(...hints.map((text) => h('li', {}, text)));
  els.hintsSection.hidden = hints.length === 0;
}
