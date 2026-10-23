# Bevvi Analytics MCP — consolidated deployment approval

**Preparation status (2026-10-05):** Implementation and **real-handler** local acceptance complete. **Deploy: BLOCKED** until the consolidated package in [`BEVVI_ANALYTICS_MCP_DEPLOYMENT_PROPOSAL.md`](BEVVI_ANALYTICS_MCP_DEPLOYMENT_PROPOSAL.md) is approved.

**Final proposal (discovery + costs + one approval request):** see that document. This file retains pins, test receipt, and post-deploy query JSON.

**Scope boundary:** New Python Streamable HTTP MCP on **separate EC2**. Excludes Node gateway Q3 repair, manifest/job mutation, Computer OAuth proxy, and legacy gateway npm test chains.

---

## Known configuration (fixed — do not substitute)

| Item | Value |
|------|--------|
| Upstream repository | `https://github.com/dchatter10019/XGBoostForecast` |
| Reviewed analytics commit (full) | `a4e707f7b8d3251677f5cdfcb71d2ead5adf7514` |
| Commit subject | Fix review analytics identity cohorts, argument validation and MCP protocol handling |
| PR reference (review baseline) | https://github.com/dchatter10019/XGBoostForecast/pull/8 |
| Merge SHA (not deploy pin) | `b7c06617e1c6646b26649988d34f63ade294dd5a` |
| Local checkout path | `vendor/XGBoostForecast` (detached HEAD at reviewed commit) |
| Verify script | `./scripts/verify-bevvi-analytics-source.sh` |
| Handler entry | `review_tools.analysis_tools.call_tool` / `validate_arguments` |
| Snapshot root env (real handler) | `BEVVI_ANALYTICS_MCP_ROOT` → read-only generation directory |
| Analytics source env | `BEVVI_ANALYTICS_SRC` → XGBoostForecast root containing `review_tools/` |
| Live gate | `BEVVI_USE_XGBOOST=0` (required) |
| Service code | `services/bevvi-analytics-mcp/` |
| MCP SDK pin | `mcp==2.3.0` |
| Target public endpoint | `https://mcp.getbevvi.com/analytics` |
| App listen (behind nginx/ALB) | `127.0.0.1:8792` |
| Exposed tools | `bevvi_analysis_data_quality`, `bevvi_period_comparison`, `bevvi_customer_trends`, `bevvi_planning_forecast` |
| Planning model (initial release) | `planning_blend_v1` only (enforced at MCP layer) |
| Required OAuth scope | `analytics:read` |
| Deploy templates | `deploy/ec2-bevvi-analytics-mcp/` |

**Clone + pin (repeatable):**

```bash
git clone https://github.com/dchatter10019/XGBoostForecast.git vendor/XGBoostForecast
git -C vendor/XGBoostForecast checkout a4e707f7b8d3251677f5cdfcb71d2ead5adf7514
./scripts/verify-bevvi-analytics-source.sh
```

---

## Local verification receipt (real handlers)

**Command:** `./scripts/bevvi-analytics-mcp-local-verify.sh`

**Settings:** `BEVVI_ANALYTICS_MCP_SYNTHETIC=0`, real `BEVVI_ANALYTICS_SRC`, isolated guard-compliant snapshot under `services/bevvi-analytics-mcp/tests/fixtures/acceptance_snapshot/` (not production data; freshness metadata refreshed at test time).

**Latest run:** `13 passed` (pytest), exit `0`, includes HTTP/auth/subprocess/parity/data-safety against **real** `review_tools.analysis_tools` (shim not used on this path).

**Local acceptance `as_of`:** `2026-09-30` (settled-cutoff safe for minimal isolated snapshot). Post-deploy business acceptance still uses `as_of: 2026-10-02` with an **approved fresh production snapshot** (§8).

| Check | Module |
|-------|--------|
| Streamable HTTP initialize / tools/list / tools/call | `test_protocol.py` |
| Four tools only | `test_protocol.py` |
| Auth negatives + protected resource metadata | `test_auth.py` |
| Subprocess timeout | `test_timeout.py` |
| Direct handler vs HTTP parity | `test_parity.py` |
| Read-only snapshot + invalid args | `test_data_safety.py` |

---

## EC2 runtime env outline (no secrets in git)

File: `/etc/bevvi-analytics-mcp.env` (values from SSM/Secrets Manager at deploy)

| Variable | Purpose |
|----------|---------|
| `BEVVI_ANALYTICS_SRC` | `/opt/bevvi-analytics-mcp/vendor/XGBoostForecast` @ reviewed commit |
| `BEVVI_ANALYTICS_MCP_ROOT` | `/var/lib/bevvi-analytics-mcp/snapshot/current` (read-only mount) |
| `BEVVI_ANALYTICS_MCP_SYNTHETIC` | `0` in production |
| `BEVVI_USE_XGBOOST` | `0` |
| `BEVVI_ANALYTICS_MCP_ISSUER_URL` | IdP issuer |
| `BEVVI_ANALYTICS_MCP_JWKS_PATH` or JWKS fetch | Token verification |
| `BEVVI_ANALYTICS_MCP_RESOURCE_URL` | `https://mcp.getbevvi.com/analytics` |
| `BEVVI_ANALYTICS_MCP_JWT_AUDIENCE` | Same as resource URL |
| `BEVVI_ANALYTICS_MCP_ALLOWED_SUBJECTS` | Comma-separated approved subjects |
| `BEVVI_ANALYTICS_MCP_PORT` | `8792` |
| `BEVVI_ANALYTICS_MCP_CALC_TIMEOUT_SEC` | `120` (align with ALB/nginx) |

---

## Checklist status (filled from discovery — 2026-10-05)

See **[`BEVVI_ANALYTICS_MCP_DEPLOYMENT_PROPOSAL.md`](BEVVI_ANALYTICS_MCP_DEPLOYMENT_PROPOSAL.md)** for discovered IDs, proposed creates, costs, snapshot route, and **one approval request**.

| Item | Discovered | Proposed / gap |
|------|------------|----------------|
| AWS account (CLI) | `064862677810` | Production account for `3.138.180.46` **TBD** |
| Region | `us-east-2` (CLI default) | Same for new stack |
| VPC (CLI) | `vpc-07bc63a0d811d33a9` (default only) | New private+public VPC recommended |
| ALB / ACM / MCP EC2 | None in queried account | Create per proposal §B |
| DNS | GoDaddy NS; `mcp` → `3.138.180.46` | ALB alias at cutover |
| IdP | None in AWS | Corp OIDC or new Cognito — **decision** |
| Snapshot source | Forecast workspace `6f1986ea` (documented) | S3 generation publish path — **approve bucket** |

---

## Post-deploy acceptance (after § Missing inputs)

1. Cursor + claude.ai: OAuth, discovery, one read-only tool call each.
2. Three historical queries at `as_of: 2026-10-02` (only after **fresh approved snapshot** mounted):

```json
[
  {
    "name": "bevvi_period_comparison",
    "arguments": {
      "as_of": "2026-10-02",
      "start_date": "2026-09-01",
      "end_date": "2026-09-30",
      "comparison": "custom",
      "baseline_start": "2026-08-01",
      "baseline_end": "2026-08-31",
      "group_by": "segment"
    }
  },
  {
    "name": "bevvi_customer_trends",
    "arguments": {
      "as_of": "2026-10-02",
      "start_date": "2026-07-01",
      "end_date": "2026-09-30"
    }
  },
  {
    "name": "bevvi_planning_forecast",
    "arguments": {
      "as_of": "2026-10-02",
      "model": "planning_blend_v1"
    }
  }
]
```

3. EC2 negative checks: no direct public app access; reboot recovery; logs without tokens/row payloads.
4. Rollback drill: `deploy/ec2-bevvi-analytics-mcp/ROLLBACK.md`.

---

## Explicit non-actions (preparation authority)

- No AWS/DNS/data transfer executed
- No production snapshot copied
- No legacy Node gateway restart
- No Q3 / manifest / job repair

---

## Approval signatures

| Role | Name | Date | Approved (Y/N) |
|------|------|------|----------------|
| Engineering | | | |
| Security / IAM | | | |
| Data owner (snapshot) | | | |
| Operations (AWS) | | | |

**Go-live gate:** Missing inputs checklist complete + post-deploy acceptance scheduled + rollback owner named.
