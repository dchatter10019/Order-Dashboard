#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${BEVVI_ANALYTICS_SRC:-$ROOT/vendor/XGBoostForecast}"
EXPECTED="${BEVVI_ANALYTICS_SOURCE_COMMIT:-a4e707f7b8d3251677f5cdfcb71d2ead5adf7514}"
if [[ ! -d "$SRC/.git" ]]; then
  echo "verify-bevvi-analytics-source: FAIL — missing git checkout at $SRC" >&2
  exit 1
fi
HEAD="$(git -C "$SRC" rev-parse HEAD)"
if [[ "$HEAD" != "$EXPECTED" ]]; then
  echo "verify-bevvi-analytics-source: FAIL — HEAD $HEAD != $EXPECTED" >&2
  exit 1
fi
SUBJECT="$(git -C "$SRC" log -1 --format=%s)"
echo "verify-bevvi-analytics-source: OK"
echo "  path: $SRC"
echo "  commit: $HEAD"
echo "  subject: $SUBJECT"
