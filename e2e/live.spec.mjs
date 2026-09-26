// The page against the REAL OSV API — no mocks.
//
//   After a deploy:  BASE_URL=https://konradcinkusz.github.io/letsgolegacy.legacy-risk-scan/
//                    (the "done when" of L18: the public page returns a report for the sample)
//   In CI smoke:     against the local build, which also proves CORS from a real browser.
//
// LIVE_SCREENSHOT names the file the full-page screenshot is written to.

import { test, expect } from '@playwright/test';
import { OSV_DOWN_MESSAGE, recordRequests } from './helpers.mjs';

test('the page reports on the sample file with real OSV data @live', async ({ page }, testInfo) => {
  const requests = recordRequests(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'Wypróbuj na przykładzie' }).click();
  await expect(page.getByRole('heading', { name: 'Raport', level: 2 })).toBeFocused({ timeout: 60_000 });

  await expect(page.getByText(OSV_DOWN_MESSAGE)).toBeHidden();
  await expect(page.getByRole('row', { name: /^\.NET Framework/ }).locator('.badge-eol')).toHaveText('Koniec wsparcia');
  const advisory = page.getByRole('link', { name: /GHSA-5crp-9r3c-p9vr/ });
  await expect(advisory).toHaveAttribute('href', 'https://osv.dev/vulnerability/GHSA-5crp-9r3c-p9vr');

  const origin = new URL(page.url()).origin;
  const external = [...new Set(requests.map((r) => new URL(r.url).origin).filter((o) => o !== origin))];
  expect(external).toEqual(['https://api.osv.dev']);

  const ids = await page.locator('.advisories a.advisory-id').evaluateAll((links) => links.map((a) => a.firstChild.textContent));
  const summary = await page.locator('#summary li').evaluateAll((tiles) => tiles.map((t) => t.innerText.replace(/\s+/g, ' ')));
  console.log(`page: ${page.url()}`);
  console.log(`summary: ${summary.join(' | ')}`);
  console.log(`advisories (${ids.length}): ${ids.join(', ')}`);
  expect(ids.length).toBeGreaterThan(0);

  const path = process.env.LIVE_SCREENSHOT || testInfo.outputPath('live-report.png');
  await page.screenshot({ path, fullPage: true });
  console.log(`screenshot: ${path}`);
});
