# Work plan — `letsgolegacy.legacy-risk-scan` (Legacy Risk Scan)

A free, public page for owners of legacy line-of-business systems: paste a project or
dependency file, get an end-of-life and known-vulnerability report in seconds, and a
clear next step — a paid audit. The page is in Polish, because its readers are Polish
manufacturing, logistics and distribution companies.

Ticket ID matches the cross-repository backlog.

| ID | Deliverable | Done when | Status |
|---|---|---|---|
| L18 | Paste `.csproj` / `packages.config` / `composer.json` → EOL and CVE report → call to action for an audit | The public page returns a report for the sample file | planned |

## Design constraints

- **Nothing pasted leaves the browser except package coordinates.** The file is parsed
  client-side; only package names and versions are sent to the public vulnerability
  database (OSV). No analytics, no storage, and the page says so.
- End-of-life data for frameworks and runtimes (.NET Framework, .NET, PHP, Angular,
  AngularJS, SQL Server, Windows Server) is bundled and dated, so the report states how
  fresh its data is.
- Static hosting (GitHub Pages); no server of our own.
- The contact block is a placeholder until the company's domain and details exist
  (ticket L17).
