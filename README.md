# Legacy Risk Scan

A free, public page from Let's go Legacy: paste a `.csproj`, `packages.config` or
`composer.json` and get an end-of-life and known-vulnerability report for the
framework and every dependency — computed in your browser. The page is in Polish.

**Live page:** <https://konradcinkusz.github.io/letsgolegacy.legacy-risk-scan/> (published
by [`deploy.yml`](.github/workflows/deploy.yml) from `main`; see
[Deployment](#deployment)). Work plan: [`docs/WORKPLAN.md`](docs/WORKPLAN.md).

## What it reads

| File | What the scan takes from it |
|---|---|
| `.csproj` / `.vbproj`, SDK-style | `TargetFramework(s)`; `PackageReference` with a `Version` attribute, a `<Version>` child, `VersionOverride` or an `$(Property)` defined in the same file. A reference with no version (central package management) is reported as *version unknown*. |
| `.csproj`, classic (pre-.NET Core) | `TargetFrameworkVersion`; NuGet id and version inferred from `HintPath` into `packages\Name.Version\`; DLLs referenced from outside the packages folder and non-framework GAC references (reported, not guessed); versioned script files such as `Scripts\jquery-1.10.2.js`. |
| `Directory.Packages.props` | `PackageVersion` / `GlobalPackageReference` items. |
| `packages.config` | Every `package` with its exact version; the newest `targetFramework` as the probable .NET Framework version. |
| `composer.json` | The `php` constraint → the **minimum** PHP version allowed; each package checked at the **lowest version its constraint allows** (or *unknown* where that cannot be determined — `dev-master`, `*`, `>4.0`). |
| `composer.lock` | Exact versions, and the platform PHP constraint. |
| `package.json` | Dependency ranges at their lowest version; `engines.node`. |

Malformed input ends in a Polish message that says what is wrong and where (line and
column for XML and JSON) — never in an exception.

## Privacy, by construction

- The pasted file is parsed **in the browser**. Nothing is uploaded.
- Outbound requests go to the public [OSV.dev](https://osv.dev) API only: one `querybatch`
  POST whose body is built by one function, `toQueries()` in
  [`src/lib/osv.js`](src/lib/osv.js) — `{ package: { ecosystem, name }, version }` per
  package and nothing else — then one GET per advisory OSV returned, by the id OSV gave.
  Tests assert that exact shape.
- The page's Content-Security-Policy lets the browser connect to the page itself and to
  `api.osv.dev` only, and load no script, style or font from anywhere else.
- No analytics, no cookies, no browser storage. The e2e suite asserts all of this against
  the built page: every request's destination, the exact request bodies, attempted
  connections blocked by the policy, cookies, `localStorage`, `sessionStorage`, IndexedDB.

## Development

Node 22 or newer. The page has no runtime dependencies — plain ES modules, served as
written, no bundler — so what is reviewed in `src/` is exactly what a visitor runs. The
only npm packages are test tooling (Playwright, axe).

```sh
./scripts/setup.sh           # checks Node, runs npm ci, installs the secret-scanning hook
npm start                    # build dist/ and serve it at
                             # http://127.0.0.1:4173/letsgolegacy.legacy-risk-scan/
npm test                     # unit tests (node:test)
npx playwright install chromium   # once, for the browser tests
npm run e2e                  # build, then Playwright against dist/ with OSV mocked
npm run smoke:osv            # the real OSV API: CORS for the published origin + contract
npm run e2e:live             # the built page against the real OSV API
BASE_URL=https://konradcinkusz.github.io/letsgolegacy.legacy-risk-scan/ npm run e2e:live
                             # …or against the published page
./scripts/scan-secrets.sh    # the same gitleaks scan CI runs
```

The local server mounts the site under `/letsgolegacy.legacy-risk-scan/`, the way GitHub
Pages serves it, so an absolute URL that would break once published breaks locally first.

### Tests, and when they run

| Layer | What | When |
|---|---|---|
| Unit (`test/`) | parsers, version constraints, end-of-life matching, OSV client, report, Polish copy; the committed `data/eol.json` | every PR and push; in the monthly data refresh before its PR opens |
| E2E, mocked (`e2e/scan.spec.mjs`) | the sample produces a report with an end-of-life row and an advisory; privacy; malformed input; OSV down + retry; server selects; file upload; keyboard; 390 px; axe in light and dark | every PR and push; before every deploy |
| Smoke, real OSV (`scripts/smoke-osv.mjs`, `e2e/live.spec.mjs`) | CORS preflight and POST for the published origin; the sample's advisory; the page in a real browser | every PR and push, weekly; a network error is a warning, a wrong answer fails |
| Post-deploy (`deploy.yml` → `verify`) | the published page, real OSV, screenshot kept as an artifact | after every deploy |

## End-of-life data

[`data/eol.json`](data/eol.json) is **generated, never edited by hand**, from the public
[endoflife.date](https://endoflife.date) API (v1; MIT-licensed data) by
[`scripts/update-eol.mjs`](scripts/update-eol.mjs). It covers .NET Framework, .NET, PHP,
Node.js, Angular, AngularJS, Laravel, Symfony, SQL Server, Windows Server, and — when
endoflife.date has them — jQuery and Bootstrap. The file carries the date it was fetched
(`generatedAt`); the report shows that date.

- **Monthly**, [`update-eol.yml`](.github/workflows/update-eol.yml) regenerates the file,
  runs the unit tests against it and opens a pull request. It needs one repository
  setting: *Settings → Actions → General → Allow GitHub Actions to create and approve pull
  requests*.
- A pull request that changes the generator gets its data regenerated on its own branch,
  so generator and data cannot disagree.
- By hand: `npm run update-eol` (behind an HTTP proxy, prefix `NODE_USE_ENV_PROXY=1`).

A version is matched to a release cycle by its longest numeric prefix (`4.5.1` → cycle
`4.5.1`, `8.0` → `8`, `7.1.3` → `7.1`). Status is computed from the dates on the day the
report is produced — "ended", "ends within 12 months", "supported" — so it stays right as
dates pass, even before the next refresh.

## Deployment

GitHub Pages, built and deployed by [`deploy.yml`](.github/workflows/deploy.yml) on every
push to `main`: unit tests → `dist/` → the mocked e2e suite against it → deploy → the
`verify` job waits until the site serves the new commit (`build.json`) and runs the live
test against it with the real OSV API, keeping a full-page screenshot as the
`live-verification` artifact.

**One manual step, once:** *Settings → Pages → Build and deployment → Source → GitHub
Actions.* Without it the first deploy fails at `configure-pages` with a 404.

## Known limitations

- **NuGet ids are matched case-sensitively by OSV** (checked against the live API: the
  smoke test reports `Newtonsoft.Json` → 1 advisory, `newtonsoft.json` → 0). Ids are sent
  exactly as written; NuGet tooling writes the canonical casing, a hand-edited
  `PackageReference` may not.
- A classic `.csproj` lists only packages that ship DLLs; content-only packages (Bootstrap,
  most jQuery plugins) are visible only in `packages.config` — the report says so.
- Constraints (`composer.json`, `package.json`, NuGet ranges) are checked at their lowest
  allowed version; the installed one may be newer. Lock files give exact results.
- Hand-copied DLLs and GAC components cannot be checked automatically; they are listed as
  needing manual review rather than guessed at.

## Layout

```
src/            the page: index.html, styles.css, app.js (wiring), render.js (DOM)
src/lib/        the engine: pure ES modules shared by the page and the tests
  manifest.js     text → format detection → parser → manifest (or a coded ScanError)
  parsers/        msbuild, packages.config, composer, package.json
  eol.js          release-cycle matching and status
  osv.js          OSV client — the privacy boundary
  report.js       rows, flags and summary counts
  messages.js     every sentence the visitor sees, in Polish
  servers.js      SQL Server / Windows Server generations for the form
scripts/        build, serve, update-eol, smoke-osv, wait-for-deploy, setup, secret scanning
data/eol.json   generated end-of-life data
samples/        the sample the page offers ("Wypróbuj na przykładzie")
test/           node:test suites and fixtures
e2e/            Playwright: the mocked acceptance suite and the live check
```

## Licence

All rights reserved; see [`LICENSE`](LICENSE).
