# Legacy Risk Scan

A free, public page from Let's go Legacy: paste a `.csproj`, `packages.config` or
`composer.json` and get an end-of-life and known-vulnerability report for the
framework and every dependency — computed in your browser. The page is in Polish.

> **Status:** under construction. The engine — parsers, end-of-life mapping, the OSV
> client and the report model — is in place and tested; the page and its deployment
> follow. See [`docs/WORKPLAN.md`](docs/WORKPLAN.md).

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
- The only outbound request is to the public [OSV.dev](https://osv.dev) API, and its body
  is built by one function, `toQueries()` in [`src/lib/osv.js`](src/lib/osv.js):
  `{ package: { ecosystem, name }, version }` per package and nothing else. Tests assert
  that exact shape.
- No analytics, no cookies, no browser storage.

## Development

Node 22 or newer. No runtime dependencies; the page is plain ES modules.

```sh
./scripts/setup.sh        # checks Node, runs npm ci, installs the secret-scanning hook
npm test                  # unit tests (node:test)
npm run smoke:osv         # the real OSV API: CORS for the published origin + contract
./scripts/scan-secrets.sh # the same gitleaks scan CI runs
```

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

## Layout

```
src/lib/        the engine: pure ES modules shared by the page and the tests
  manifest.js     text → format detection → parser → manifest (or a coded ScanError)
  parsers/        msbuild, packages.config, composer, package.json
  eol.js          release-cycle matching and status
  osv.js          OSV client — the privacy boundary
  report.js       rows, flags and summary counts
  messages.js     every sentence the visitor sees, in Polish
scripts/        update-eol, smoke-osv, setup, secret scanning
data/eol.json   generated end-of-life data
samples/        the sample the page offers ("Wypróbuj na przykładzie")
test/           node:test suites and fixtures
```

## Licence

All rights reserved; see [`LICENSE`](LICENSE).
