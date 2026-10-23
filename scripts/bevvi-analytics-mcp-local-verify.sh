#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="$ROOT/services/bevvi-analytics-mcp"
SRC="${BEVVI_ANALYTICS_SRC:-$ROOT/vendor/XGBoostForecast}"
export BEVVI_ORDER_DASHBOARD_ROOT="$ROOT"
export BEVVI_ANALYTICS_SRC="$SRC"
export BEVVI_ANALYTICS_MCP_SYNTHETIC=0
export BEVVI_USE_XGBOOST=0
"$ROOT/scripts/verify-bevvi-analytics-source.sh"
cd "$SERVICE"
if [[ ! -x .venv/bin/pytest ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -r requirements.txt
fi
.venv/bin/pytest -q
echo "bevvi-analytics-mcp-local-verify: OK"
