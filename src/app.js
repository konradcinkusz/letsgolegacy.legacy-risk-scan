// Page wiring: form → scan → report. The scan logic lives in lib/ and is unit-tested;
// this file only moves text between the DOM and it.
//
// Nothing here stores anything (no cookies, no localStorage, no IndexedDB) and the only
// network calls are to this page's own files and, inside lib/osv.js, to api.osv.dev.

import { rebuildReport, runScan } from './lib/scan.js';
import { ERROR_MESSAGES, UI, attentionSentence, errorMessage, format } from './lib/messages.js';
import { serverOptions } from './lib/servers.js';
import { formatDate, plural } from './lib/format.js';
import { todayIso } from './lib/eol.js';
import { MAX_INPUT_CHARS } from './lib/manifest.js';
import { attentionCount, renderReport } from './render.js';

const $ = (id) => document.getElementById(id);
const els = {
  form: $('scan-form'),
  textarea: $('manifest'),
  file: $('file'),
  mssql: $('mssqlserver'),
  windows: $('windows-server'),
  error: $('scan-error'),
  status: $('status'),
  sample: $('sample'),
  report: $('report'),
  reportTitle: $('report-title'),
  retry: $('retry'),
  print: $('print'),
  ctaAttention: $('cta-attention'),
  dataDate: $('data-date'),
  render: {
    meta: $('report-meta'),
    osvWarning: $('osv-warning'),
    summary: $('summary'),
    summaryNote: $('summary-note'),
    attention: $('attention'),
    meaning: $('meaning'),
    platform: $('platform'),
    dependencies: $('dependencies'),
    hints: $('hints'),
    hintsSection: $('hints-section'),
  },
};

const SAMPLE_URL = 'samples/Sklep.Legacy.csproj';
const pageUrl = (path) => new URL(path, document.baseURI);

let running = null; // AbortController of the scan in progress
let last = null; // the last successful scan, for rebuilding with other server choices

const setStatus = (text) => {
  els.status.textContent = text;
};

function showError(text) {
  els.error.textContent = text;
  els.error.hidden = false;
}

function hideError() {
  els.error.hidden = true;
  els.error.textContent = '';
}

function fillSelect(select, options) {
  for (const { value, label } of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

const eolReady = (async () => {
  try {
    const response = await fetch(pageUrl('data/eol.json'));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    fillSelect(els.mssql, serverOptions(data.products?.mssqlserver));
    fillSelect(els.windows, serverOptions(data.products?.['windows-server']));
    els.dataDate.textContent = formatDate(data.generatedAt);
    return data;
  } catch {
    showError(ERROR_MESSAGES.EOL_DATA_UNAVAILABLE);
    return null;
  }
})();

const infraChoice = () => ({ mssqlserver: els.mssql.value, 'windows-server': els.windows.value });

function show(report, { focus }) {
  renderReport(report, els.render);
  els.report.hidden = false;
  els.ctaAttention.textContent = attentionSentence(attentionCount(report));
  els.ctaAttention.hidden = false;
  if (focus) {
    const total = report.summary.total;
    setStatus(format(UI.statusDone, { count: total, noun: plural(total, ['pozycję', 'pozycje', 'pozycji']) }));
    els.reportTitle.focus();
  }
}

async function scan(text) {
  running?.abort();
  const controller = new AbortController();
  running = controller;
  hideError();
  els.form.setAttribute('aria-busy', 'true');
  setStatus(UI.statusParsing);
  try {
    const eolData = await eolReady;
    const result = await runScan(text, {
      eolData,
      today: todayIso(),
      infra: infraChoice(),
      signal: controller.signal,
      onProgress: (stage, detail) => {
        if (stage === 'osv') setStatus(format(UI.statusOsv, { count: detail.queries }));
      },
    });
    if (controller.signal.aborted) return;
    if (!result.ok) {
      last = null;
      els.report.hidden = true;
      els.ctaAttention.hidden = true;
      setStatus('');
      showError(errorMessage(result.error));
      return;
    }
    last = { ...result, text, eolData };
    show(result.report, { focus: true });
  } catch (e) {
    if (e?.name === 'AbortError' || controller.signal.aborted) return;
    setStatus('');
    showError(ERROR_MESSAGES.UNEXPECTED);
  } finally {
    if (running === controller) {
      running = null;
      els.form.removeAttribute('aria-busy');
    }
  }
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  scan(els.textarea.value);
});

els.sample.addEventListener('click', async () => {
  hideError();
  try {
    const response = await fetch(pageUrl(SAMPLE_URL));
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    els.textarea.value = await response.text();
  } catch {
    showError(ERROR_MESSAGES.SAMPLE_UNAVAILABLE);
    return;
  }
  setStatus(UI.statusSample);
  scan(els.textarea.value);
});

els.file.addEventListener('change', async () => {
  const file = els.file.files?.[0];
  if (!file) return;
  hideError();
  // Refuse before reading: a wrongly chosen multi-gigabyte file must not be loaded at all.
  if (file.size > MAX_INPUT_CHARS * 4) {
    showError(errorMessage({ code: 'INPUT_TOO_LARGE', params: { limitMb: 2 } }));
    return;
  }
  try {
    els.textarea.value = await file.text();
  } catch {
    showError(ERROR_MESSAGES.FILE_READ_FAILED);
    return;
  }
  setStatus(format(UI.statusFile, { name: file.name }));
  scan(els.textarea.value);
});

for (const select of [els.mssql, els.windows]) {
  select.addEventListener('change', () => {
    if (!last || running) return;
    const report = rebuildReport(last, { eolData: last.eolData, today: todayIso(), infra: infraChoice() });
    last = { ...last, report };
    show(report, { focus: false });
    setStatus(UI.statusUpdated);
  });
}

els.retry.addEventListener('click', () => {
  if (last) scan(last.text);
});

els.print.addEventListener('click', () => window.print());
