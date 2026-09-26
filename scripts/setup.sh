#!/usr/bin/env bash
#
# setup.sh — one-command onboarding (REPO-BASELINE.md §3).
#
#   ./scripts/setup.sh
#
# §3 is written for a service repository: a secret store, a generated mandatory secret,
# optional integrations. None of that exists here — the page has no secrets and talks
# only to public, unauthenticated APIs — so those steps are omitted rather than faked.
# What applies: check the runtime, install dependencies, install the secret-scanning
# hook, and say which optional tool enables which test layer.

set -euo pipefail
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "${REPO_ROOT}"

step()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
amber() { printf '\033[0;33m%s\033[0m\n' "$*"; }
red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }

step "1. Node.js (22 or newer)"
if ! command -v node >/dev/null 2>&1; then
  red "  node is not installed — https://nodejs.org/en/download"; exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 22 ]; then
  red "  node $(node -v) is too old; 22 or newer is required (the test runner and fetch)."; exit 1
fi
green "  node $(node -v)"

step "2. Dependencies (development tooling only; the page itself has none)"
npm ci
green "  npm ci done"

step "3. Secret-scanning pre-commit hook"
HOOK_DST="$(git rev-parse --git-path hooks)/pre-commit"
mkdir -p "$(dirname "${HOOK_DST}")"
cp scripts/hooks/pre-commit "${HOOK_DST}"
chmod +x "${HOOK_DST}"
green "  installed → ${HOOK_DST}"
if ! command -v gitleaks >/dev/null 2>&1 && ! (command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1); then
  amber "  No scanner found: the hook will REFUSE commits until gitleaks or Docker is available."
  amber "  (That is deliberate — P5.) https://github.com/gitleaks/gitleaks#installing"
fi

step "4. Optional — a browser for the end-to-end tests (needed for: npm run e2e)"
echo "  npx playwright install chromium"

step "Ready"
echo "  npm start              build and serve on http://127.0.0.1:4173/letsgolegacy.legacy-risk-scan/"
echo "  npm test               unit tests (parsers, end-of-life mapping, OSV client, report)"
echo "  npm run e2e            Playwright against the built page, OSV mocked"
echo "  npm run e2e:live       the built page against the real OSV API"
echo "  npm run update-eol     refresh data/eol.json from endoflife.date"
echo "  npm run smoke:osv      check the real OSV API (CORS + contract)"
echo "  ./scripts/scan-secrets.sh   mirror the CI secret scan"
