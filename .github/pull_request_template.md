## Ticket

<!-- Ticket id from docs/WORKPLAN.md, and its "done when" line verbatim. -->

## What changes, and why

<!-- The behaviour that changed and the reason. For anything the visitor sees, say what
     they now see; the page is in Polish, so quote the Polish text. -->

## Privacy check

<!-- The page promises that only package coordinates (ecosystem, name, version) leave the
     browser. Tick one. -->

- [ ] This change does not touch what the page sends over the network
- [ ] This change touches it, and the e2e privacy test (`e2e/`) still asserts the request body

## How it was verified

- [ ] `npm test` (unit)
- [ ] `npm run e2e` (Playwright, OSV mocked)
- [ ] `./scripts/scan-secrets.sh` clean
- [ ] If `data/eol.json` changed: the diff was read, not only regenerated
