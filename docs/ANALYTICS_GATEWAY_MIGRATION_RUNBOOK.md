# Analytics gateway — quiesced migration runbook (preparation only)

Use this when ops authorizes cutover. **This repository pass does not execute these steps.**

## Preconditions (all required)

- Reviewer tools/list export installed with matching `Bevvi-Python-Tools-List-Export.SHA256` (`2f70b4be…` target).
- `BEVVI_ANALYTICS_GATEWAY_ARTIFACT_DOWNLOAD_ALLOW_HOSTS` set from approved host table.
- Provider pagination response fields verified against captured evidence.
- Native advisory locks verified on target Node/OS/local filesystem; jobs directory and parents trusted (mode `0700`, not symlinked).

## 1. Inventory

- List all running gateway server processes and cron/systemd retry schedulers using the production jobs directory.
- List mutating CLI usage (`analytics-gateway-reconcile-job.mjs`, any custom scripts writing jobs or leases).

## 2. Quiesce writers

- Stop accepting new analytics submissions at the edge (dashboard/API) if applicable.
- Stop gateway server gracefully (releases store singleton mutex).
- Confirm no mutating CLI holds the store.

## 3. Secured backup (never in Git or review ZIP)

- Copy the entire jobs directory and OAuth store paths to encrypted local backup.
- Record backup checksum and time; restrict filesystem permissions.

## 4. Inspect unresolved work

- Jobs in `submission_uncertain`, `needs_auth`, `needs_input`, `awaiting_artifact`, active thread admission.
- **Do not** assume local process death implies remote Computer task stopped.
- Plan reconcile/artifact-only recovery; **never** auto-resubmit unresolved remote calculations.

## 5. Single protocol version

- Deploy one gateway build only (OS mutex + per-job locks).
- Do not run legacy compare-and-unlink gate workers against the same store.
- Install exact schema sidecar and approved download hosts before enabling smoke/production flags.

## 6. Verify after start

- One server acquires store mutex; second instance fails fast at startup.
- Health on loopback; mock disabled in production mode.
- Spot-check periodic queued-job scan and signal coalescing.

## Rollback

- Quiesce new version completely before starting old binaries.
- Never mix old/new ownership protocols on one jobs directory.
- Restore from secured backup if durable state was corrupted.

## Approvals (none granted by documentation alone)

- Read-only provider metadata capture
- One live data-quality smoke job
- Migration window and deployment
- `BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE=true`
