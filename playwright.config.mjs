// End-to-end tests against the BUILT site (dist/), served under the same sub-path GitHub
// Pages uses, so a URL that only works at the domain root fails here first.
//
//   chromium — the acceptance suite, OSV mocked for determinism (every PR, and before deploy)
//   live     — the same page against the REAL OSV API; BASE_URL points it at the published
//              site after a deploy, or it runs against the local build in the smoke job

import { defineConfig, devices } from '@playwright/test';

const LOCAL = 'http://127.0.0.1:4173/letsgolegacy.legacy-risk-scan/';
const baseURL = process.env.BASE_URL || LOCAL;

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Zero tolerance for flakiness in the mocked suite: no retries.
    { name: 'chromium', testIgnore: /live\.spec/, retries: 0, use: { ...devices['Desktop Chrome'] } },
    // The live project depends on a third-party service; retries absorb a network blip.
    { name: 'live', testMatch: /live\.spec/, retries: 2, use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'node scripts/serve.mjs --dir dist --port 4173 --base /letsgolegacy.legacy-risk-scan/',
        url: LOCAL,
        reuseExistingServer: !process.env.CI,
      },
});
