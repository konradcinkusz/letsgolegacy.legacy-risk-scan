// The acceptance suite for the page, OSV mocked. Locators are roles and accessible names
// first (what a visitor, or a screen reader, sees), data-testid only for the summary
// tiles, which have no accessible name of their own. Every test ends in unconditional
// assertions; no fixed sleeps anywhere.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { OSV_DOWN_MESSAGE, blockOtherHosts, mockOsv, recordRequests } from './helpers.mjs';

// End-of-life status is computed on the day of the report; the suite runs on a fixed day
// so a date passing does not change what it asserts.
const TODAY = new Date('2026-09-26T10:00:00Z');

const reportHeading = (page) => page.getByRole('heading', { name: 'Raport', level: 2 });
const row = (page, name) => page.getByRole('row', { name });
const tileCount = (page, kind) => page.getByTestId(`summary-${kind}`).locator('.count');

async function openAndRunSample(page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Wypróbuj na przykładzie' }).click();
  await expect(reportHeading(page)).toBeFocused();
}

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(TODAY);
  await blockOtherHosts(page);
});

test('the sample file produces a report with an end-of-life item and a linked advisory', async ({ page }) => {
  await mockOsv(page);
  await openAndRunSample(page);

  await expect(page.getByLabel('Zawartość pliku')).toHaveValue(/Sklep\.Legacy/);
  await expect(tileCount(page, 'eol')).not.toHaveText('0');
  await expect(tileCount(page, 'vulnerable')).not.toHaveText('0');

  const framework = row(page, /^\.NET Framework/);
  await expect(framework.locator('.badge-eol')).toHaveText('Koniec wsparcia');
  await expect(framework).toContainText('4.5.1');
  await expect(framework).toContainText('12 stycznia 2016');

  const advisory = page.getByRole('link', { name: /GHSA-5crp-9r3c-p9vr/ });
  await expect(advisory).toHaveAttribute('href', 'https://osv.dev/vulnerability/GHSA-5crp-9r3c-p9vr');
  await expect(row(page, /^Newtonsoft\.Json/)).toContainText('Poprawka w wersji: 13.0.1');

  await expect(page.getByRole('heading', { name: 'Co to oznacza dla firmy' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Po końcu wsparcia \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText(/^Gotowe\. Raport obejmuje \d+ pozycj/);
});

test('the report ends with the audit offer and no invented contact details', async ({ page }) => {
  await mockOsv(page);
  await openAndRunSample(page);
  const cta = page.getByRole('region', { name: 'Zamów audyt Second Key' });
  await expect(cta).toContainText('Raport wskazuje');
  await expect(cta).toContainText('Kontakt: wkrótce.');
  await expect(page.locator('a[href^="mailto:"], a[href^="tel:"]')).toHaveCount(0);
});

test('privacy: only package coordinates leave the browser, and nothing is stored', async ({ page, context }) => {
  const requests = recordRequests(page);
  // The Content-Security-Policy blocks a connection to any other host before a request
  // exists, so an attempt would never show up as traffic; count the attempts as well.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await mockOsv(page);
  await openAndRunSample(page);

  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute(
    'content',
    /(^|; )connect-src 'self' https:\/\/api\.osv\.dev;/,
  );
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);

  const origin = new URL(page.url()).origin;
  const external = requests.filter((r) => new URL(r.url).origin !== origin);
  expect(external.length).toBeGreaterThan(0);
  expect(external.map((r) => new URL(r.url).origin)).toEqual(external.map(() => 'https://api.osv.dev'));

  const posts = external.filter((r) => r.method === 'POST');
  expect(posts.length).toBeGreaterThan(0);
  for (const post of posts) {
    const body = JSON.parse(post.body);
    expect(Object.keys(body)).toEqual(['queries']);
    for (const query of body.queries) {
      expect(Object.keys(query).sort()).toEqual(['package', 'version']);
      expect(Object.keys(query.package).sort()).toEqual(['ecosystem', 'name']);
    }
    expect(post.body).not.toContain('Sklep'); // the project's name
    expect(post.body).not.toContain('Drukarki'); // a hand-copied DLL has no coordinates to send
    expect(post.body).not.toContain('\\'); // no paths
  }
  for (const r of external) expect(r.headers.referer).toBeUndefined();
  for (const get of external.filter((r) => r.method === 'GET')) {
    expect(new URL(get.url).pathname).toMatch(/^\/v1\/vulns\/[A-Za-z0-9-]+$/);
  }

  expect(await context.cookies()).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
});

test('a damaged file gets a clear Polish message and no report', async ({ page }) => {
  await mockOsv(page);
  await page.goto('./');
  await page.getByLabel('Zawartość pliku').fill('<Project>\n  <ItemGroup>\n</Project>');
  await page.getByRole('button', { name: 'Sprawdź plik' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Plik wygląda na XML, ale jest uszkodzony: znacznik </Project> nie pasuje do otwartego <ItemGroup> (wiersz 3, kolumna 1). Sprawdź, czy został wklejony w całości.',
  );
  await expect(page.getByRole('region', { name: 'Raport' })).toBeHidden();
});

test('an empty form asks for a file', async ({ page }) => {
  await mockOsv(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Sprawdź plik' }).click();
  await expect(page.getByRole('alert')).toHaveText('Wklej zawartość pliku albo wybierz plik z dysku.');
});

test('a file that is not a manifest is named for what it is', async ({ page }) => {
  await mockOsv(page);
  await page.goto('./');
  await page.getByLabel('Zawartość pliku').fill('<?xml version="1.0"?>\n<configuration><appSettings /></configuration>');
  await page.getByRole('button', { name: 'Sprawdź plik' }).click();
  await expect(page.getByRole('alert')).toContainText('To plik konfiguracyjny (web.config lub app.config)');
});

test('OSV unreachable: end-of-life results still shown, with a warning and a working retry', async ({ page }) => {
  await mockOsv(page, { fail: true });
  await openAndRunSample(page);
  await expect(page.getByText(OSV_DOWN_MESSAGE)).toBeVisible();
  await expect(row(page, /^\.NET Framework/).locator('.badge-eol')).toBeVisible();
  await expect(tileCount(page, 'vulnerable')).toHaveText('0');
  await expect(row(page, /^Newtonsoft\.Json/)).toContainText('nie sprawdzono — brak połączenia z OSV');

  await page.unroute('https://api.osv.dev/**');
  await mockOsv(page);
  await page.getByRole('button', { name: 'Sprawdź podatności ponownie' }).click();
  await expect(page.getByRole('link', { name: /GHSA-5crp-9r3c-p9vr/ })).toBeVisible();
  await expect(page.getByText(OSV_DOWN_MESSAGE)).toBeHidden();
});

test('servers chosen in the form join the report without asking OSV again', async ({ page }) => {
  await mockOsv(page);
  await openAndRunSample(page);
  const requests = recordRequests(page);

  await page.getByLabel('Microsoft SQL Server').selectOption({ label: '2016' });
  await page.getByLabel('Windows Server').selectOption({ label: '2012 R2' });

  const sql = row(page, /^Microsoft SQL Server/);
  await expect(sql.locator('.badge-eol')).toBeVisible();
  await expect(sql).toContainText('2016 SP3');
  await expect(sql).toContainText('14 lipca 2026');
  const windows = row(page, /^Windows Server/);
  await expect(windows.locator('.badge-eol')).toBeVisible();
  await expect(windows).toContainText('13 października 2026');
  expect(requests.filter((r) => r.url.startsWith('https://api.osv.dev/'))).toEqual([]);
});

test('a file chosen from disk is read locally and scanned', async ({ page }) => {
  await mockOsv(page);
  await page.goto('./');
  await page.getByLabel(/wybierz plik z dysku/).setInputFiles({
    name: 'composer.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ require: { php: '^7.1.3', 'laravel/framework': '5.6.*' } })),
  });
  await expect(reportHeading(page)).toBeFocused();
  await expect(row(page, /^PHP/).locator('.badge-eol')).toBeVisible();
  await expect(row(page, /^PHP/)).toContainText('co najmniej 7.1.3');
  await expect(row(page, /^laravel\/framework/)).toContainText('ograniczenie: 5.6.*');
});

test('keyboard only: Tab reaches "Wypróbuj na przykładzie", Enter runs it, focus moves to the report', async ({ page }) => {
  await mockOsv(page);
  await page.goto('./');
  await page.getByLabel('Zawartość pliku').focus();
  const sample = page.getByRole('button', { name: 'Wypróbuj na przykładzie' });
  for (let i = 0; i < 8 && !(await sample.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press('Tab');
  }
  await expect(sample).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(reportHeading(page)).toBeFocused();
});

test('a phone-width screen (390 px): no horizontal scrolling, rows become cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockOsv(page);
  await openAndRunSample(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.locator('thead').first()).toHaveCSS('position', 'absolute');
});

const seriousViolations = (results) =>
  results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);

for (const colorScheme of ['light', 'dark']) {
  test.describe(`${colorScheme} colour scheme`, () => {
    test.use({ colorScheme });

    test('no serious or critical accessibility violations, before and after a report', async ({ page }) => {
      await mockOsv(page);
      await page.goto('./');
      const before = await new AxeBuilder({ page }).analyze();
      expect(seriousViolations(before)).toEqual([]);
      await page.getByRole('button', { name: 'Wypróbuj na przykładzie' }).click();
      await expect(reportHeading(page)).toBeFocused();
      const after = await new AxeBuilder({ page }).analyze();
      expect(seriousViolations(after)).toEqual([]);
    });
  });
}
