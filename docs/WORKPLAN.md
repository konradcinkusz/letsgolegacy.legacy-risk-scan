# Work plan — `letsgolegacy.legacy-risk-scan` (Legacy Risk Scan)

A free, public page for owners of legacy line-of-business systems: paste a project or
dependency file, get an end-of-life and known-vulnerability report in seconds, and a
clear next step — a paid audit. The page is in Polish, because its readers are Polish
manufacturing, logistics and distribution companies.

Ticket ID matches the cross-repository backlog.

| ID | Deliverable | Done when | Status |
|---|---|---|---|
| L18 | Paste `.csproj` / `packages.config` / `composer.json` → EOL and CVE report → call to action for an audit | The public page returns a report for the sample file | done: published since 26 IX 2026, and `deploy.yml`'s `verify` job passes (run 37116401196 on 4f4e346); two steps below stay open |

### L18 — what remains

Implemented in two stacked pull requests: #1 (engine, end-of-life data pipeline, baseline)
and #2 (the page, deployment, end-to-end tests). The page is published at
<https://konradcinkusz.github.io/letsgolegacy.legacy-risk-scan/>. Every push to `main` runs
`deploy.yml`, whose `verify` job loads the **published** page, runs the sample against the
real OSV API and keeps a full-page screenshot (artifact `live-verification`). It passes (run
37116401196 on 4f4e346), so the "done when" is met.

1. ~~*Settings → Pages → Build and deployment → Source → GitHub Actions* (one time).~~ Done;
   the first successful deploy was on 26 IX 2026.
2. ~~Merge #1, then #2.~~ Done on 26 IX 2026. The first `deploy.yml` run on `main` failed at
   `configure-pages` with a 404, as expected before step 1.
3. ~~The push to `main` runs `deploy.yml`; its `verify` job passes.~~ Done, see above.
4. **Open:** for the monthly end-of-life data pull request: *Settings → Actions → General →
   Allow GitHub Actions to create and approve pull requests*. The scheduled run of 1 X 2026
   fetched and tested the data but failed at "Open or update the pull request" without it;
   the data in `data/eol.json` (3 X 2026) came from the `sync-pr` job of a pull request.
5. **Open:** when L17 delivers the domain and contact e-mail, replace the `TODO(L17)`
   placeholder in `src/index.html` ("Kontakt: wkrótce").

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
