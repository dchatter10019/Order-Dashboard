# Bevvi Analytics Gateway (local implementation)

## Reuse report (October 2026 inspection)

| Area | In this repo today | Reusable? |
|------|-------------------|-----------|
| Perplexity Computer OAuth / token refresh | **Not present** in committed code | N/A — implement in `lib/analyticsGateway/` |
| Computer MCP client (`read_thread`, `call_perplexity_computer`) | **Not present** | N/A — `computerMcpClient.cjs` (mock + live stub) |
| Analytics handlers / `ml.mcp.review_server` | **Not in repo** (runs only inside Computer) | Invoked via fixed server templates upstream |
| Order Dashboard `server.js` (3001) | Present | **Do not** mount gateway on order server; separate process |
| Dashboard login (`lib/dashboardAuth.cjs`) | Present | **Not** used for gateway — separate client tokens |
| `.env` Perplexity vars (historical) | May exist locally only; not in `env.example` | Wire through gateway env, never commit |

**Blockers before EC2 cutover**

1. **Administrator OAuth** to `https://www.perplexity.ai/rest/computer/mcp` must be completed once; gateway stores tokens under `data/analytics-gateway/` (gitignored).
2. **Live end-to-end** result retrieval (asset bind + schema validation) must pass on Computer; until then set `BEVVI_ANALYTICS_GATEWAY_ENABLED=false` or run in `mock` mode only.
3. **Private git remote** before any push (repo was public during preparation).

## Architecture (approved)

```
Internal app → HTTPS https://mcp.getbevvi.com/analytics (EC2 gateway only)
            → loopback analytics gateway process
            → Computer MCP (OAuth)
            → review_server in Computer workspace (cache in cron_tracking)
```

EC2 is **not** the compute host. No cache copy to EC2/Mac.

## Local development

```bash
# Install MCP SDK (pinned in package.json)
npm install

# Mock mode (default): fixture results, no Computer
export BEVVI_ANALYTICS_GATEWAY_MODE=mock
export BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN=local-dev-token-change-me
node scripts/analytics-gateway-server.mjs

# Tests (fixtures only)
node scripts/analytics-gateway-test.mjs
```

Gateway listens on `127.0.0.1:BEVVI_ANALYTICS_GATEWAY_PORT` (default **8791**). MCP-style tools via `POST /analytics` (JSON-RPC).

### Gateway tools (implemented here, not upstream)

- `request_analytics` — allowlisted operation + validated args → job id
- `get_analytics_job` — status
- `get_analytics_result` — job-bound envelope when `succeeded`

### Allowed operations

- `bevvi_analysis_data_quality`
- `bevvi_planning_forecast`
- `bevvi_period_comparison`
- `bevvi_customer_trends`
- `bevvi_historical_seasonality`

## Computer constants (do not change without review)

| Setting | Value |
|---------|--------|
| Thread UUID | `40f3ef7a-ab04-486c-9e52-9c2485d1cec8` |
| Review checkout | `/home/user/workspace/bevvi-mcp-analysis-review` @ `a4e707f7b8d3251677f5cdfcb71d2ead5adf7514` |
| Operational root | `/home/user/workspace/cron_tracking/6f1986ea` |

## Result delivery (live / smoke)

The gateway **does not** treat Computer transcript text as the job result. A job reaches `succeeded` only after the handler JSON is fetched from a **thread asset** bound to the server job id.

Computer task text (`lib/analyticsGateway/taskTemplates.cjs`) requires:

1. Write the complete handler JSON to `/home/user/workspace/bevvi-analytics-jobs/{jobId}.json` (single permitted write).
2. **Register/share** that file on the fixed thread as a thread asset named `{jobId}.json`, visible in `list_thread_assets` before the task completes. A workspace file alone is insufficient.
3. Gateway retrieval uses `list_thread_assets` + `create_asset_download` (URL fetch), then `decision_support_v3` validation.

Recovery and reconcile paths are asset-only; see `artifactDelivery.cjs`, `jobRecovery.cjs`, `reconcileJob.cjs`.

## Deployment (proposal only — **not applied**)

See `deploy/ec2-analytics-gateway/` for additive Nginx location and systemd unit template. **Stop before** installing on EC2, reloading Nginx, or issuing production credentials until live E2E is approved.

## Rollback

Disable `bevvi-analytics-gateway.service` and remove the `/analytics` location block only. Do not touch `bevvi-mcp.service`, `/mcp`, `/rachel/`, or `/whatsapp/`.
