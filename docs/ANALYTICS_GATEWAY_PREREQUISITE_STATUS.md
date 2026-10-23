# Bevvi Analytics Gateway — prerequisite status

**Prepared:** October 4, 2026 (updated: bounded provider-contract and capture corrections)  
**Input bundle SHA-256:** `ec00e2076f9d3388c1c4bdf3e27b1191f25410ad86b035d092dd67f8c9ecfa0a`  
**Latest test environment:** Linux x64, Node.js v20.20.1, `fs-ext@2.0.0`, isolated synthetic jobs dirs, mock mode, production/smoke enable false. Earlier macOS results remain historical, not rerun here.

This document does **not** authorize live smoke, deployment, production enablement, OAuth use, or migration of a real job store.

---

## 1. Reviewer tools/list export (exact bytes)

| Status | **VERIFIED_OFFLINE** |

| Check | Result |
|-------|--------|
| Source | `Bevvi-Exact-Reviewer-Schema.zip` → `Bevvi-Authoritative-Analytics-Tool-Schemas.json` (byte copy, no reserialize) |
| Required SHA-256 | `2f70b4be07e889adc936222debed9b92f204e03d09a09d370f1b343f04dce663` |
| Installed `Bevvi-Python-Tools-List-Export.json` | **Matches** (same digest) |
| Sidecar `Bevvi-Python-Tools-List-Export.SHA256` | **Matches** |
| Tool count at startup | 5 (`result.tools`) |

**Offline verified:** `assertToolsListIntegrity()` succeeds with exact bytes; rejects `sha_mismatch` and `missing_integrity_sidecar`; full `npm run test:analytics-gateway` (17 suites) passes.

---

## 2. Artifact download host approval

| Status | **APPROVAL_REQUIRED** — `artifact_hosts_approval_required` |

| Host / suffix | Evidence origin | Purpose | Approval |
|---------------|-----------------|---------|----------|
| `d2z0o16i8xm8ak.cloudfront.net` | User-supplied October 4 provider capture, reviewed offline | Proposed exact-host artifact HTTPS fetch | **Observed, not approved** |

**Code behavior (unchanged, verified offline):** `secureArtifactDownload.mjs` requires `BEVVI_ANALYTICS_GATEWAY_ARTIFACT_DOWNLOAD_ALLOW_HOSTS` for production/smoke paths; exact/suffix boundary matching; lookalike rejection; private/reserved IP DNS checks; pinned connect + TLS SNI; redirect revalidation. Tests use `asset.mock` only in synthetic suites.

**Action:** Obtain explicit approval before configuring this exact host; do not permit all CloudFront domains. Leave the real allowlist unset. `env.example.gateway-snippet.txt` remains unchanged.

---

## 3. Provider pagination contract (`list_thread_assets`)

| Status | **VERIFIED_OFFLINE against captured contract**; updated capture/live adapter not rerun against provider |

| Topic | Finding |
|-------|---------|
| Evidence | Captured provider tool definitions plus reviewed seven-page response trace; source evidence ZIP SHA-256 `033513751b24998ce4df3da434e2e1c54d96215a1e386b739cb68b8b0a410ff9` |
| Current adapter mapping | Request: `thread_id` plus optional opaque `cursor`. Response: strict `assets` and explicit `next_cursor`. Only null continuation terminates, regardless of page length. |
| Failure handling | Rejected/malformed/transport errors retained; repeated cursor/page and cap exhaustion fail closed. Unresolved remote admission is retained as `delivery_failed` or `needs_auth`. |
| Distinct schemas | `Computer-Provider-Tool-Definitions.json` describes provider metadata tools. The exact Bevvi Python tools/list export remains separate and unchanged. |

**Action:** Apply locally and validate the corrected read-only capture under its existing authorization before any separately approved live smoke. Capture no longer stores raw cursors, guesses targets or mutates OAuth; it records checkpoints rather than false completion.

**Not executed:** Live provider list call in this pass.

---

## 4. Single gateway / scheduler per jobs store

| Status | **VERIFIED_OFFLINE** (narrow scope) |

| Item | Result |
|------|--------|
| Enforcement | `gatewayStoreSingleton.cjs` — OS mutex `gateway-server.singleton.mutex` under `{jobsDir}/.os-mutex/` |
| Server startup | `analytics-gateway-server.mjs` acquires before recovery/dispatch watchers; second process gets `gateway_store_busy` |
| Mutating reconcile CLI | `reconcileGatewayJob()` holds **maintenance store ownership** for full async reconcile (read → fetch stub/live → validation → writes); not a probe-and-release |
| Server vs reconcile order | Server-first and reconcile-first (paused read) both enforce exclusion; two concurrent maintenance attempts reject second owner |
| Same-process async overlap | Maintenance ownership is non-reentrant; B returns `gateway_store_busy` before read/fetch/mutation, while A retains ownership until completion |
| Native flock errors | `acquireAdvisoryLockHold()` closes descriptor on non-busy acquisition throw (synthetic ENOSYS probe) |
| Shutdown / SIGKILL | Descriptor release allows re-acquisition; mutex file not unlinked |
| Separate stores | Independent jobs directories → independent mutex roots |
| Scope | **One gateway server per local jobs directory on one host** — not general multi-host or NFS |

**Tests:** `analytics-gateway-gateway-store-singleton-test.mjs` (child processes plus same-process async overlap). Unchanged independent maintenance-lifetime probes pass 3/3; store probes pass 4/4.

**Limitation:** Other mutating CLIs besides reconcile are documented maintenance-only with server stopped; not all CLI entry points are wrapped.

---

## 5. OS advisory lock + wrapper (accepted baseline)

| Status | **VERIFIED_OFFLINE** (independent Linux + supplied suites) |

Retained tenth-pass design: stable mutex files, thenable rejection, `O_NOFOLLOW`, symlink root rejection. The current seventeen-suite chain passes; unchanged independent OS-lock probes remain covered separately.

---

## 6. Migration / cutover runbook

| Status | **NOT_EXECUTED** (documentation only) |

See `docs/ANALYTICS_GATEWAY_MIGRATION_RUNBOOK.md`. No quiesce, backup, or production store change in this pass.

---

## 7. Separate approvals still required before live

| Gate | Status |
|------|--------|
| Read-only provider evidence capture | Prior user capture reviewed; corrected capture not executed live in this pass |
| One live data-quality smoke | NOT_EXECUTED |
| Job-store migration / deployment | NOT_EXECUTED |
| Production enablement | NOT_EXECUTED |

Internal gateway authentication remains mandatory; `getbevvi.com` hostname alone is not authorization.

---

## Summary

| Prerequisite | Status |
|--------------|--------|
| Exact reviewer tools/list bytes | VERIFIED_OFFLINE |
| Artifact host allowlist | APPROVAL_REQUIRED |
| Provider pagination mapping | Verified offline against prior capture; fresh corrected-client live check pending |
| Store singleton (local) | VERIFIED_OFFLINE |
| OS lock ownership | VERIFIED_OFFLINE |
| Migration execution | NOT_EXECUTED |

**Precise scope:** Schema, maintenance and provider mapping corrections are validated offline. Host approval, fresh corrected-client verification and a separately authorized end-to-end smoke remain prerequisites; migration/deployment/production are not enabled.
