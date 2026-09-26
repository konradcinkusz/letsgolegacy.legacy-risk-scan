import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ERROR_MESSAGES,
  FORMAT_LABELS,
  NOTE_CODES,
  attentionSentence,
  errorMessage,
  hintText,
  noteText,
} from '../src/lib/messages.js';
import { formatDate, plural, relativeToToday } from '../src/lib/format.js';

test('every error code the parsers can raise has a Polish sentence', () => {
  const codes = [
    'EMPTY_INPUT', 'INPUT_TOO_LARGE', 'UNKNOWN_FORMAT', 'SOLUTION_FILE', 'XML_MALFORMED', 'XML_CONFIG_FILE',
    'XML_UNSUPPORTED_ROOT', 'JSON_MALFORMED', 'JSON_UNSUPPORTED', 'PACKAGE_LOCK_UNSUPPORTED', 'MANIFEST_INVALID', 'UNEXPECTED',
  ];
  for (const code of codes) assert.ok(ERROR_MESSAGES[code], code);
});

test('malformed XML: the reason, line and column are spelled out', () => {
  const text = errorMessage({ code: 'XML_MALFORMED', params: { line: 12, column: 5, reason: 'mismatched-tag', expected: 'ItemGroup', found: 'Project' } });
  assert.equal(
    text,
    'Plik wygląda na XML, ale jest uszkodzony: znacznik </Project> nie pasuje do otwartego <ItemGroup> (wiersz 12, kolumna 5). Sprawdź, czy został wklejony w całości.',
  );
});

test('malformed JSON with and without a position', () => {
  assert.match(errorMessage({ code: 'JSON_MALFORMED', params: { line: 3, column: 7 } }), /błąd składni \(wiersz 3, kolumna 7\)\./);
  assert.match(errorMessage({ code: 'JSON_MALFORMED', params: {} }), /błąd składni\. Sprawdź/);
  assert.equal(errorMessage({ code: 'NO_SUCH_CODE' }), ERROR_MESSAGES.UNEXPECTED);
});

test('every version reason the parsers produce has a note', () => {
  const reasons = ['not-specified', 'cpm', 'floating', 'unresolved-property', 'exclusive-lower-bound', 'no-lower-bound',
    'dev-branch', 'non-registry', 'dist-tag', 'unparseable', 'package-folder-no-version'];
  for (const reason of reasons) {
    const code = `VERSION_${reason.toUpperCase().replace(/-/g, '_')}`;
    assert.ok(NOTE_CODES.includes(code), code);
  }
});

test('notes and hints render their parameters, dates in Polish', () => {
  assert.equal(
    noteText({ code: 'EOL_ESU_UNTIL', params: { date: '2026-10-13' } }),
    'Płatne rozszerzone aktualizacje bezpieczeństwa (ESU) są dostępne do 13 października 2026 — tylko jeśli firma je wykupiła.',
  );
  assert.equal(hintText({ code: 'HINT_PLATFORM_PACKAGES', params: { names: ['ext-pdo', 'ext-json'] } }), 'Pominięto wymagania platformy (rozszerzenia PHP i podobne): ext-pdo, ext-json.');
  for (const format of ['msbuild-legacy', 'msbuild-sdk', 'cpm-props', 'packages-config', 'composer-json', 'composer-lock', 'package-json']) {
    assert.ok(FORMAT_LABELS[format], format);
  }
});

test('Polish plurals', () => {
  assert.equal(attentionSentence(1), 'Raport wskazuje 1 pozycję wymagającą uwagi.');
  assert.equal(attentionSentence(3), 'Raport wskazuje 3 pozycje wymagające uwagi.');
  assert.equal(attentionSentence(5), 'Raport wskazuje 5 pozycji wymagających uwagi.');
  assert.equal(attentionSentence(12), 'Raport wskazuje 12 pozycji wymagających uwagi.');
  assert.equal(attentionSentence(22), 'Raport wskazuje 22 pozycje wymagające uwagi.');
  assert.match(attentionSentence(0), /nie wskazuje/);
  assert.equal(plural(2, ['a', 'b', 'c']), 'b');
});

test('dates', () => {
  assert.equal(formatDate('2016-01-12'), '12 stycznia 2016');
  assert.equal(formatDate('2026-11-10'), '10 listopada 2026');
  assert.equal(relativeToToday('2016-01-12', '2026-09-26'), '10 lat temu');
  assert.equal(relativeToToday('2026-11-10', '2026-09-26'), 'za 45 dni');
  assert.equal(relativeToToday('2027-06-01', '2026-09-26'), 'za 8 miesięcy');
});
