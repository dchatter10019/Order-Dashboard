# Bevvi Analytics MCP (Python)

OAuth-protected Streamable HTTP MCP exposing four read-only analytics tools. This service is **separate** from the legacy Node Computer gateway.

## Local verification (synthetic)

```bash
cd services/bevvi-analytics-mcp
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/pytest -q
```

Or from repo root:

```bash
./scripts/bevvi-analytics-mcp-local-verify.sh
```

Production deploy uses real `review_tools.analysis_tools` from `BEVVI_ANALYTICS_SRC` at commit **`a4e707f7b8d3251677f5cdfcb71d2ead5adf7514`** and a **fresh approved snapshot** on `BEVVI_ANALYTICS_MCP_ROOT`.

Obtain/verify source from repo root:

```bash
./scripts/verify-bevvi-analytics-source.sh
./scripts/bevvi-analytics-mcp-local-verify.sh
```

Local verify runs with `BEVVI_ANALYTICS_MCP_SYNTHETIC=0` (real handlers) and an isolated acceptance snapshot — not production data.

## Run locally (synthetic handler)

```bash
export BEVVI_ORDER_DASHBOARD_ROOT="/path/to/Order-Dashboard"
export BEVVI_ANALYTICS_MCP_SYNTHETIC=1
export BEVVI_ANALYTICS_MCP_JWKS_PATH="/path/to/jwks.json"
export BEVVI_ANALYTICS_MCP_ISSUER_URL="https://auth.example.test"
export BEVVI_ANALYTICS_MCP_RESOURCE_URL="http://127.0.0.1:8792/analytics"
export BEVVI_ANALYTICS_MCP_JWT_AUDIENCE="$BEVVI_ANALYTICS_MCP_RESOURCE_URL"
PYTHONPATH=. .venv/bin/python -m bevvi_analytics_mcp
```

Pinned SDK: `mcp==2.3.0` (Streamable HTTP resource server + external JWT verification).
