# Analytics gateway repair — blockers and assumptions

## Bounded provider-contract correction (October 4, 2026)

- Captured metadata contract applied: no offset/limit; explicit assets/next_cursor; null continuation only, with repeated-page/cursor and cap failure.
- Provider rejections and malformed responses are not missing artifacts. Delivery failures retain unresolved admission; no resubmission introduced.
- Standalone capture uses existing token only, no OAuth callbacks/refresh/registration, no redirects or off-endpoint requests, no artifact body fetch.
- Capture saves cursor hashes and only exact target identity; stops before download metadata for incomplete/ambiguous/missing target.
- Seventeen suites include sixteen new provider-contract checks. No live provider call in this repair.
- Host `d2z0o16i8xm8ak.cloudfront.net` remains an observed, unapproved candidate. Allowlist unchanged; corrected capture and live smoke not run.

## Focused maintenance correction (October 4, 2026)

- Existing same-process maintenance ownership now rejects a second caller with `gateway_store_busy`; no shared release handle.
- The first reconcile retains the store mutex across its async work. Added regression verifies B never fetches or mutates, and another process remains blocked until A completes.
- Sixteen suites pass on Linux; unchanged maintenance-lifetime probes 3/3, store probes 4/4, OS-lock probes 8/8 and earlier follow-up 7/7 pass.
- Original independent kit remains 9/10 only because of its documented direct-lock completion bypass, not a current blocker.
- Exact reviewer schema preserved. Artifact-host approval and provider-pagination evidence are still outstanding. No live or operational changes performed.

## Twelfth pass (maintenance mutex lifetime, October 4, 2026)

- Reconcile holds store OS mutex for full async operation; no probe-and-release.
- `acquireAdvisoryLockHold` closes descriptors on flock errors.

## Eleventh pass (prerequisites + store singleton, October 4, 2026)

- Gateway store OS mutex: one server/scheduler owner per `{jobsDir}`; mutating reconcile blocked while server holds lock.
- Prerequisite status doc, migration runbook (preparation only), `env.example` artifact-host placeholder.
- Reviewer schema install **not** performed (attachment missing/mismatch).

## Tenth repair pass (OS lock wrapper, October 4, 2026)

- Reject Promise/thenable mutex callback results (`mutex_async_result_rejected`); synchronous callers only.
- Mutex root boundary without symlink following; `O_NOFOLLOW` open + `fstat` validation; close fd on open/validation failure.

## Ninth repair pass (eighth-pass ownership blocker, October 4, 2026)

- OS advisory mutex (`fs-ext` flock) for per-job processing serialization and dispatch-signal writes.
- Stable mutex files under `{jobsDir}/.os-mutex/`; no unlink/rename for lock release.
- Executor lease JSON remains separate; all lease read/write/reclaim under the job OS mutex.
- Startup requires working advisory locks (no fallback to compare-and-unlink gates).

### Future quiesced migration / rollback (not performed in this pass)

1. **Quiesce** all gateway workers and reconcile CLIs on the shared jobs directory.
2. **Inspect** jobs in non-terminal states and unresolved thread admission; resolve or document before cutover.
3. **Deploy** a single protocol version; do not run old gate/unlink workers against the same store.
4. **Rollback:** stop new workers, restore prior binary only after quiesce; legacy `.processing-gate-*` files are not interoperable with `.os-mutex/` — treat rollback as reverting code **and** ensuring no concurrent mixed writers.
5. **Synthetic-only validation** in this repair uses fresh `BEVVI_ANALYTICS_GATEWAY_JOBS_DIR` paths only.

## Eighth repair pass (seventh independent review)

- Best-effort dispatch signal; terminal job state decoupled from wakeup publication.

## Fourth repair pass (third independent review, October 4, 2026)

- Non-enqueuing artifact delivery; uncertain jobs reconcile artifact-only.
- Tools list loader supports JSON-RPC `result.tools`; integrity sidecar; startup fails closed on SHA mismatch.
- Pagination terminal-page fix; abandoned local processing-lease reclaim rules.
- Queued-job dispatch when thread admission is released.

## Before live smoke / EC2

See `docs/ANALYTICS_GATEWAY_PREREQUISITE_STATUS.md` for current status.

1. ~~**Replace tools/list export**~~ — **Done offline:** reviewer bytes installed; sidecar `2f70b4be…`.
2. **Artifact CDN allowlist** — ops-approved hosts in `BEVVI_ANALYTICS_GATEWAY_ARTIFACT_DOWNLOAD_ALLOW_HOSTS` (unset = fail closed).
3. **Provider mapping** — prior captured evidence reviewed and adapter corrected offline; fresh corrected-client live verification remains pending.
4. **One gateway server per jobs directory** — enforced via store singleton mutex; not multi-host/NFS readiness.

## Retained

Duplicate-submit lease protection, SDK handshake, 24h freshness, pinned HTTPS connect, approved code hash `8a8539119267a0ebbea7d44d62d09a32c5abda2a82b0f69bf22e9098ffcce9a4`.
