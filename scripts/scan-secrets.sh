#!/usr/bin/env bash
#
# scan-secrets.sh — the local mirror of the CI secret-scan job (REPO-BASELINE.md §4).
#
# Usage:
#   scripts/scan-secrets.sh            full git history (what CI runs)
#   scripts/scan-secrets.sh --staged   staged changes only (what the hook runs)
#   scripts/scan-secrets.sh --dir      the working tree as plain files

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
CONFIG="${REPO_ROOT}/.gitleaks.toml"
MODE="${1:-history}"

case "${MODE}" in
  --staged) ARGS=(git --staged) ;;
  --dir)    ARGS=(dir) ;;
  history)  ARGS=(git) ;;
  *) echo "Usage: scripts/scan-secrets.sh [--staged|--dir]"; exit 2 ;;
esac

if command -v gitleaks >/dev/null 2>&1; then
  gitleaks "${ARGS[@]}" "${REPO_ROOT}" --config="${CONFIG}" --redact --no-banner --verbose
elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  docker run --rm -v "${REPO_ROOT}:/repo" -w /repo ghcr.io/gitleaks/gitleaks:latest \
    "${ARGS[@]}" /repo --config=/repo/.gitleaks.toml --redact --no-banner --verbose
else
  echo "scan-secrets: neither gitleaks nor a running Docker daemon is available."
  echo "Install gitleaks: https://github.com/gitleaks/gitleaks#installing"
  exit 1
fi
echo "Secret scan clean."
