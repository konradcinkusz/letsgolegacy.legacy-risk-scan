# Work plan — `letsgolegacy.legacy-risk-scan` (Legacy Risk Scan)

A free, public page for owners of legacy line-of-business systems: paste a project or
dependency file, get an end-of-life and known-vulnerability report in seconds, and a
clear next step — a paid audit. The page is in Polish, because its readers are Polish
manufacturing, logistics and distribution companies.

Ticket ID matches the cross-repository backlog.

| ID | Deliverable | Done when | Status |
|---|---|---|---|
| L18 | Paste `.csproj` / `packages.config` / `composer.json` → EOL and CVE report → call to action for an audit | The public page returns a report for the sample file | merged (#1, #2); done when `deploy.yml`'s `verify` job passes — waiting on step 1 below |

### L18 — what remains after the merge

Implemented in two stacked pull requests: #1 (engine, end-of-life data pipeline,
baseline) and #2 (the page, deployment, end-to-end tests). Checked in CI before review:
the sample produces a report with end-of-life rows and a real OSV advisory in a real
browser, and OSV answers CORS for the published origin. Not yet checked: the published
page itself, which does not exist until the steps below.

1. *Settings → Pages → Build and deployment → Source → GitHub Actions* (one time).
2. ~~Merge #1, then #2.~~ Done on 26 IX 2026. The first `deploy.yml` run on `main` failed at
   `configure-pages` with a 404, as expected before step 1.
3. The push to `main` runs `deploy.yml`. Its `verify` job loads the **published** page,
   runs the sample against the real OSV API and keeps a full-page screenshot
   (artifact `live-verification`). When it passes, the "done when" is met: mark L18
   **done**.
4. For the monthly end-of-life data pull request: *Settings → Actions → General → Allow
   GitHub Actions to create and approve pull requests*.
5. When L17 delivers the domain and contact e-mail, replace the `TODO(L17)` placeholder in
   `src/index.html` ("Kontakt: wkrótce").

## Design constraints

- **Nothing pasted leaves the browser except package coordinates.** The file is parsed
  client-side; only package names and versions are sent to the public vulnerability
  database (OSV). No analytics, no storage, and the page says so.
- End-of-life data for frameworks and runtimes (.NET Framework, .NET, PHP, Node.js,
  Angular, AngularJS, Laravel, Symfony, SQL Server, Windows Server, and — when
  endoflife.date has them — jQuery and Bootstrap) is bundled and dated, so the report
  states how fresh its data is.
- Static hosting (GitHub Pages); no server of our own.
- The contact block is a placeholder until the company's domain and details exist
  (ticket L17).
