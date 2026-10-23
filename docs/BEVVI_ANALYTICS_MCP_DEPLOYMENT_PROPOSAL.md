# Bevvi Analytics MCP — final deployment proposal (approval request)

**Prepared:** 2026-10-05 · **Authority:** read-only discovery + repo pins · **No changes executed**

This document is the single approval request for go-live. It separates **discovered facts** from **proposed defaults**. Local code acceptance is **READY** (`13 passed`, real handlers @ `a4e707f7b8d3251677f5cdfcb71d2ead5adf7514`); **deploy remains BLOCKED** until signatures at the end.

---

## A. Discovered facts (verified)

### Repository / analytics code (not data)

| Fact | Source |
|------|--------|
| Handler repo | `https://github.com/dchatter10019/XGBoostForecast` |
| Deploy pin | `a4e707f7b8d3251677f5cdfcb71d2ead5adf7514` |
| Local verify | `./scripts/bevvi-analytics-mcp-local-verify.sh` → 13 passed, `BEVVI_ANALYTICS_MCP_SYNTHETIC=0` |
| MCP service | `services/bevvi-analytics-mcp/`, port **8792**, path **`/analytics`** |
| Legacy Node gateway | Separate; docs reference same hostname — **cutover must be explicit** |

### Public DNS (not AWS API)

| Fact | Value |
|------|--------|
| `getbevvi.com` NS | `ns25.domaincontrol.com`, `ns26.domaincontrol.com` (**GoDaddy**, not Route53 in queried account) |
| `mcp.getbevvi.com` A | **`3.138.180.46`** (live today) |
| Implication | DNS is edited at **GoDaddy** (or API tied to it). Existing host likely serves current `mcp` stack; Python MCP is a **new** private EC2 + controlled cutover. |

### AWS CLI session used for discovery

| Fact | Value |
|------|--------|
| Caller account | **`064862677810`** |
| Default CLI region | **`us-east-2`** |
| Default VPC | **`vpc-07bc63a0d811d33a9`** (`172.31.0.0/16`) |
| Public subnets (default VPC) | `subnet-0cdb9f8c100992f02` (2a), `subnet-05c08601a061a5541` (2b), `subnet-0af343a56913e50db` (2c) — **MapPublicIpOnLaunch=true** |
| Route53 hosted zones | **0** in this account |
| ACM issued certs | **0** in `us-east-2` and `us-east-1` |
| ALBs | **0** in `us-east-2` and `us-east-1` |
| Running EC2 reservations | **0** in `us-east-2` and `us-east-1` |
| Cognito user pools | **0** in `us-east-2` |
| IAM account alias | **none** |
| AWS Organizations | **not in use** |
| Elastic IP `3.138.180.46` | **Not** in account `064862677810` (us-east-1/2) |

**Interpretation:** The credentials/profile used (`default`, region `us-east-2`) do **not** appear to be the production account that hosts **`mcp.getbevvi.com` (3.138.180.46)**. Production VPC/ALB/cert/IdP discovery in the **Bevvi production AWS account** is still required.

### Identity (AWS)

No Cognito pool, IAM Identity Center (SSO) inventory, or OAuth IdP for MCP was discoverable in account `064862677810`. **Zoho OAuth** in repo docs is for **invoicing/dashboard**, not MCP audience `https://mcp.getbevvi.com/analytics`.

---

## B. Proposed defaults (where discovery is incomplete)

Use these only after confirming the **correct AWS account** and network. Adjust IDs once production SSO profile is used.

### Target architecture (unchanged design)

```text
Cursor / claude.ai  →  HTTPS  mcp.getbevvi.com/analytics
                              →  Internet-facing ALB (TLS)
                              →  Private subnet EC2 (Python MCP, :8792)
                              →  Read-only snapshot mount (BEVVI_ANALYTICS_MCP_ROOT)
```

- **Do not** attach production transaction APIs or Computer OAuth to the MCP process.
- **Do not** reuse `/home/user/workspace/cron_tracking/6f1986ea` on the MCP host as a live refresh engine.

### AWS account and region

| Item | Proposal |
|------|----------|
| Account | **Production Bevvi account** that owns **`3.138.180.46`** (TBD — not `064862677810` unless explicitly chosen as greenfield) |
| Region | **`us-east-2`** (aligns with existing `mcp` A record IP range and CLI default) |

**If greenfield in `064862677810` instead:** new VPC recommended (default VPC is all-public; design wants **private app subnet + public ALB subnets**).

### Network — resources to **create** (greenfield or new VPC)

| Resource | Purpose | ID (discovered) | Proposed spec |
|----------|---------|-----------------|---------------|
| VPC | Isolated network | — | `10.50.0.0/16` (example; non-overlapping with peered nets) |
| Public subnets ×2 | ALB only | — | `10.50.0.0/24`, `10.50.1.0/24` (2 AZ) |
| Private subnets ×2 | MCP EC2 | — | `10.50.10.0/24`, `10.50.11.0/24` |
| Internet gateway | ALB egress/ingress | — | Attached to VPC |
| NAT gateway ×1 (or endpoints) | SSM, patches, JWKS, optional S3 | — | Single NAT **or** interface endpoints: `ssm`, `ssmmessages`, `ec2messages`, `s3` |
| ALB | TLS termination, path `/analytics` | — | **New** application LB, HTTPS listener |
| Target group | MCP instances :8792 | — | HTTP health `GET /healthz` |
| Security group `alb-mcp` | World → 443 | — | Inbound 443 from `0.0.0.0/0` |
| Security group `mcp-app` | ALB → app only | — | Inbound **8792** from `alb-mcp` SG only |
| EC2 `bevvi-analytics-mcp-1` | Python MCP | — | **Private**, no public IP; SSM for admin |
| IAM instance profile | SSM + (optional) read S3 snapshot prefix | — | No S3 write on app role |

**Reuse (only if in production account after re-discovery):** existing shared ALB, WAF, or corporate VPC — must still add **dedicated target group + private MCP instance**; do not colocate with forecast training runtime.

### TLS and DNS

| Item | Discovered | Proposal |
|------|------------|----------|
| DNS zone | GoDaddy NS for `getbevvi.com` | Change **`mcp`** host to **ALB alias** (GoDaddy ANAME/CNAME flattening) at cutover |
| ACM cert | None in queried account | **Request** `mcp.getbevvi.com` (+ optional `*.getbevvi.com`) in **same region as ALB** (`us-east-2`) |
| Current A record | `3.138.180.46` | **Rollback:** restore A record to prior IP; keep TTL low (300s) for first cutover |

### EC2 host (template aligned with repo)

- Unit: `deploy/ec2-bevvi-analytics-mcp/bevvi-analytics-mcp.service.template`
- Code: pinned `XGBoostForecast` + `services/bevvi-analytics-mcp/` venv
- Env file: `/etc/bevvi-analytics-mcp.env` (SSM Parameter Store / Secrets Manager — **not in git**)

### Estimated ongoing AWS cost (order of magnitude, us-east-2)

| Component | Monthly estimate (USD) |
|-----------|-------------------------|
| ALB | ~$18 base + ~$5–15 LCU (low traffic) |
| EC2 `t3.small` (private) | ~$15 |
| NAT gateway (if used) | ~$32 + ~$0.045/GB |
| VPC interface endpoints (alt. to NAT) | ~$7–15/endpoint + data |
| S3 snapshot storage (100 GB example) | ~$2–3 |
| CloudWatch logs/metrics | ~$5–20 |
| **Total (typical starter)** | **~$75–110/mo** with NAT; **~$50–70/mo** with endpoints-only egress |

Exact spend depends on snapshot size, query volume, and whether MCP shares an existing ALB/NAT.

---

## C. Approved snapshot source and publishing route

### Source of truth (private data — **not** GitHub)

| Layer | Location | Notes |
|-------|----------|--------|
| **Authoritative runtime** | Computer / forecast server: `/home/user/workspace/cron_tracking/6f1986ea` | Documented in `docs/BEVVI_ANALYTICS_GATEWAY.md`, `XGBoostForecast/docs/AUTOMATIC_CHECKINS.md` |
| **Required tree for MCP** | Under that root: `ml/cache/transactions_normalized/*.csv`, paired `ml/cache/transactions_raw/*.json`, `ml/reports/phase1_preview_state.json`, `calibration_config.json` (or documented absence + runtime default OFF) | Validated by real `load_history` / `assert_guarded` — **no fabrication** |
| **Code only** | Git @ `a4e707f7…` | Explicitly **excludes** transaction caches per export policy |

**Approved snapshot source (proposal):** the **post-refresh normalized cache generation** produced by the existing guarded daily pipeline on the forecast workspace (same inputs the operational report uses), exported as an **immutable generation bundle** after operator sign-off on checksums.

### Publishing route (proposal — no transfer executed)

1. **Export (forecast side, separate privileged job):** after daily cache refresh succeeds, run a read-only packager on `6f1986ea` that copies only the MCP manifest paths into `generation-<utc>-<sha256prefix>/`, writes `MANIFEST.json` + SHA256 sidecars, **does not** mutate source cache.
2. **Upload:** `aws s3 sync` to **`s3://<TBD-bucket>/bevvi-analytics-mcp/generations/<id>/`** (SSE-KMS, bucket policy deny insecure transport).
3. **Promote (publisher IAM, not MCP app):** validate manifest vs objects; atomically set SSM parameter `/bevvi/analytics-mcp/current_generation` = `<id>`.
4. **Consume (MCP EC2):** startup/cron on host rsyncs **one** generation to `/var/lib/bevvi-analytics-mcp/snapshot/<id>/`, read-only bind; `BEVVI_ANALYTICS_MCP_ROOT` points at promoted generation; **reject** if newest partition `fetched_at` age **> 24h** (handler-enforced).
5. **Cadence:** align with existing daily refresh; MCP never refreshes from tool calls.

**First go-live blocker:** one **operator-approved fresh generation** with recorded checksums and Eastern settled-date acceptance — not the local `acceptance_snapshot` test fixture.

---

## D. Identity, authorized users, OAuth

| Requirement | Discovered | Proposal |
|-------------|------------|----------|
| MCP auth | None in AWS account queried | **Managed OIDC** (existing corp IdP preferred; else **new Cognito User Pool** + federated login) |
| Scope | — | `analytics:read` |
| Audience / resource | — | `https://mcp.getbevvi.com/analytics` |
| Token validation | — | JWT: issuer + JWKS, exp, audience, scope; subject allowlist `BEVVI_ANALYTICS_MCP_ALLOWED_SUBJECTS` |
| Cursor | — | Static OAuth client per [Cursor MCP docs](https://cursor.com/docs/mcp) |
| claude.ai | — | Separate “Use your own OAuth client” registration |
| Authorization | — | **Group-based** allowlist (not `@getbevvi.com` suffix alone) |

**Secrets:** JWKS URL, client secrets, and env files only in SSM/Secrets Manager — never in chat or git.

---

## E. Deployment, acceptance, DNS cutover, rollback

### Deployment sequence (after approval)

1. Confirm AWS account + SSO profile for production.
2. Create/reuse VPC, ALB, ACM, private EC2, SGs, IAM (§B).
3. Install release: verify `verify-bevvi-analytics-source.sh`, deploy venv + systemd, **no** `BEVVI_ANALYTICS_MCP_SYNTHETIC`.
4. Mount **first approved fresh generation** on EC2; fail closed if stale.
5. Configure IdP + MCP env; smoke JWT on loopback only.
6. ALB target health green on `/healthz`.
7. **Pre-cutover:** OAuth + tools/list from Cursor and Claude against ALB DNS name (optional staging hostname).
8. **Cutover:** GoDaddy `mcp` → ALB alias; nginx on `3.138.180.46` **stops serving `/analytics`** for MCP (or host decommissioned per plan).
9. Post-cutover acceptance (§F).
10. Rollback drill documented.

### Rollback

- **Fast:** GoDaddy `mcp` A record back to **`3.138.180.46`**; stop `bevvi-analytics-mcp.service` on new instance.
- **Data:** keep prior snapshot generation ID on EC2; never rewrite generations in place (`deploy/ec2-bevvi-analytics-mcp/ROLLBACK.md`).

### Post-deploy acceptance tests (after fresh snapshot)

- Cursor + claude.ai: OAuth, discovery, one read-only tool each.
- Three agreed JSON queries at **`as_of: 2026-10-02`** (see `docs/BEVVI_ANALYTICS_MCP_DEPLOYMENT_APPROVAL.md` §8).
- Negative: no direct public access to :8792; auth failures; logs without tokens/row bodies.

---

## F. Filled checklist (IDs + gaps)

| Item | Status | Value |
|------|--------|--------|
| AWS account (queried) | Discovered | `064862677810` |
| AWS account (production `mcp`) | **Missing** | Account owning **`3.138.180.46`** — **decision required** |
| Region | Discovered default / proposed | `us-east-2` |
| VPC (queried) | Discovered | `vpc-07bc63a0d811d33a9` (default; **not recommended** for final design) |
| Private subnet | **Create** | TBD in prod VPC |
| ALB | **Create** | TBD |
| ACM ARN | **Create** | TBD (`mcp.getbevvi.com`) |
| EC2 MCP instance | **Create** | TBD (private) |
| DNS | Discovered | GoDaddy; `mcp` → `3.138.180.46` today → **change to ALB at cutover** |
| IdP | **Missing** | Name tenant + issuer URL — **decision required** |
| Snapshot S3 bucket | **Create** | `s3://<TBD>/bevvi-analytics-mcp/generations/` |
| Publisher IAM | **Create** | Write-only to snapshot prefix |
| App IAM | **Create** | SSM + S3 read snapshot prefix only |
| OAuth clients | **Create** | Cursor + Claude — **decision required** (client names/owners) |
| Authorized subjects | **Missing** | Group → subject list — **decision required** |

---

## G. ONE approval request

Please approve **one package** (reply with account/IdP decisions where marked):

1. **AWS:** Confirm **production account** (vs greenfield `064862677810`); approve VPC+ALB+private EC2 in **`us-east-2`**, resource specs §B, and monthly cost band **~$50–110**.
2. **Reuse vs create:** Confirm whether to attach to existing production VPC/ALB or build net-new stack; **do not** merge MCP onto forecast training host.
3. **Identity:** Name IdP; approve scope `analytics:read`, audience `https://mcp.getbevvi.com/analytics`, MFA + group allowlist; authorize creation of **two** OAuth clients (Cursor, Claude).
4. **Private data:** Approve snapshot **source** (forecast workspace `6f1986ea` cache generation), **S3 bucket/prefix**, publisher cadence, first **fresh generation** checksum sign-off, and read-only mount on MCP EC2.
5. **Cutover:** Approve GoDaddy DNS change for `mcp.getbevvi.com`, legacy `/analytics` behavior on `3.138.180.46`, maintenance window, and rollback owner.
6. **Acceptance:** Approve post-deploy tests §E–F including `2026-10-02` business queries on **real** snapshot only.

**Not requested in this approval:** AWS resource creation, data transfer, DNS edit, or service start.

---

## H. Access gap — single decision needed

To replace **proposed defaults** with **production resource IDs**, provide **one** of:

- AWS SSO profile name (or role) for the account that owns **`3.138.180.46`**, **or**
- Written confirmation that deploy should proceed **greenfield in account `064862677810`** with a new VPC (accepting that `mcp.getbevvi.com` currently points elsewhere until cutover).

Also name the **corporate IdP** (or approve new Cognito) for MCP OAuth.

---

## Signatures

| Role | Name | Date | Approved |
|------|------|------|----------|
| Engineering | | | |
| Security / IAM | | | |
| Data owner | | | |
| Operations / AWS | | | |
