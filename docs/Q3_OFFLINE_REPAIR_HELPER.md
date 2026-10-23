# Q3 Offline Repair Helper: Implementation and Review

This change implements a one-time offline artifact-import helper and synthetic regression tests. Implementation approval is NOT permission to invoke it on the real store. No real repair plan or execution-context attestation is supplied with this code.

## Entry points

- `lib/analyticsGateway/offlineArtifactRepair.cjs`: internal transaction engine, inert on import. Its policy argument allows synthetic test fixtures; it is not a public administrative API.
- `scripts/analytics-gateway-q3-offline-repair.mjs`: fixed Q3 identity, original artifact digest, contaminated-job digest, thread, arguments, key and historical asset ID. It never accepts alternate values for those fields.
- `scripts/analytics-gateway-q3-offline-repair-test.mjs`: isolated temporary-store tests only.

`--help` is safe and does not import the engine or acquire store locks. Actual execution requires all three explicit CLI inputs: `--plan`, `--approved-plan-sha256`, and `--execute-approved-q3-repair`. There is deliberately no automatic default-store, dotenv, live fetch, dry-run-with-side-effects, forced-reconcile, restart, queue-cleanup, clock override, or plan-generation path.

These flags are operator safeguards, not authentication against a user who can edit local files or invoke the internal engine. Separate human execution approval remains mandatory.

## Current operational blockers remain

- The real store reportedly has four queued jobs. This helper refuses any active/unknown/malformed job state, regardless of whether `waitingForThreadAdmission` is false. It does not resolve, cancel, hide or skip those jobs.
- Original submission context still requires evidence review. The current regenerated manifest and contaminated envelope are not proof of original execution mode.
- The artifact was verified by Cursor in a temporary directory. Its continued existence and digest must be rechecked before future execution.
- The current manifest must be pinned by its actual current bytes. Do not restore run `38935f40-…` or change submission counts to three just to satisfy obsolete acceptance wording.

Successful synthetic tests do not clear these operational blockers or validate the real evidence pack.

## Future reviewed plan contract

Only after further preparation and separate execution approval, an operator may prepare a private JSON plan with this shape. The placeholders are not executable evidence. Never create fabricated logs, excerpts, reviewer assertions or submission IDs to satisfy this schema.

```json
{
  "schema_version": "q3_offline_repair_plan_v1",
  "jobs_dir": "<absolute existing operational jobs directory>",
  "evidence_parent": "<absolute existing private directory outside jobs>",
  "artifact_path": "<absolute original wrapper JSON path outside jobs>",
  "manifest_path": "<absolute current manifest path outside jobs>",
  "manifest_sha256": "<reviewed current manifest byte digest>",
  "manifest_run_id": "<actual current manifest run_id>",
  "execution_context": {
    "mode": "local_test",
    "job_id": "6a529ed9-0f69-422f-a9c9-e6c52da717ad",
    "request_hash": "9d7a8cc7a087f42ab1c60426b40605783b16511c256087bdd6ae10162b497cac",
    "thread_id": "40f3ef7a-ab04-486c-9e52-9c2485d1cec8",
    "idempotency_key": "approved-local-test-2026-10-04-planning_forecast_30d-e3c8dd5e-7bdf-49d1-8b0c-ac55aa5be7b6",
    "submission_attempt_id": "<full original attempt UUID from job and independent evidence>",
    "reviewer": "<person who actually reviewed the referenced evidence>",
    "reviewed_statement": "Original submission was local_test; not inferred from the mock envelope or artifact.",
    "references": [
      {
        "kind": "submission_log",
        "path": "<absolute retained submission log or launch receipt outside jobs>",
        "sha256": "<original file byte digest>",
        "excerpts": ["<exact original evidence excerpts; not reconstructed text>"]
      }
    ]
  }
}
```

Reference kinds are `submission_log` or `launch_receipt`. Combined excerpts must corroborate the original job ID, original attempt UUID, idempotency key and `local_test`. The helper mechanically checks their existence and digests, but cannot prove what a log means or who authored it. A human must review provenance and approve the complete plan digest. If existing evidence cannot support these requirements, stop for review; do not loosen them or create replacement evidence.

The current manifest is pinned solely for preservation. It is not treated as the historical execution-context source. Every referenced original file is byte-copied into the private repair evidence directory.

## Transaction guarantees

- One maintenance-store hold spans every job read, validation, backup, atomic replacement, readback and receipt. A target processing-mutex hold is acquired as well; competing ownership fails closed.
- Existing stable `.os-mutex` files are allowed and never unlinked. Any thread-admission or processing/mutation lease blocks. No admission cleanup is implemented, which is intentionally narrower than the earlier optional-cleanup proposal.
- Quiescence is checked under ownership. A store snapshot pins all regular top-level files except the stable mutex directory, including dispatch bookkeeping and other jobs. Unknown JSON, symlinks, hard-linked input files, unfinished temp files and unreadable input fail closed.
- All inputs must be absolute existing paths, with no symlink components. Evidence is written to a new mode-0700 child directory outside jobs; files use mode 0600 and exclusive creation.
- The original wrapper bytes must match the pinned digest. Full binding, approved source, v3, freshness and operational validation use existing validators at actual current time. No backdating and no wrapper reconstruction.
- Missing persisted execution mode can be initialized to `local_test` only from the reviewed evidence pack. A conflicting mode blocks.
- The validator creates the new envelope. The helper preserves every unrelated job field and existing audit event, appending a historical correction event marked `offline_verified_artifact_import`. It never claims successful original automatic delivery or a new provider download.
- The historical asset ID remains the originally recorded ID. Reattaching identical bytes does not silently replace it with a new attachment ID; missing entry/version metadata stays null.
- After prevalidation, byte backups, the approved plan, context references, current manifest and a prepared receipt are persisted before commit. The target and all pinned inputs are rechecked. Only then is the target replaced once through an exclusive same-directory temp file and atomic rename.
- Job readback, consumer validation and unchanged-manifest/other-store checks precede the final atomic receipt. Locks release in `finally`.

The standalone writer uses exclusive temporary-file creation plus file/directory fsync and atomic rename, rather than the generic writer's predictable temporary name. No generic job transitions, admission dispatch or worker code are invoked.

## Failures and repeats

Before commit, a failure leaves the job untouched; a partial evidence directory may remain for inspection. After commit, any readback/fsync/receipt failure returns `committed: true` and a checkpoint. It never automatically rolls back to mock data, retries, changes another job, or starts a service.

A second invocation stops at the changed original job digest. It does not claim `ALREADY_REPAIRED` without a separate receipt audit. On an OS/process crash there may be only a prepared receipt; do not interpret that as committed or rerun blindly. Compare the target against the before/after digests in that receipt under a separately approved read-only audit.

The gateway must remain stopped, with no other harness or administrative writer. File snapshots and cooperative locks do not protect against a malicious process that ignores the locking protocol.

## Authorized offline test commands

```sh
node scripts/analytics-gateway-q3-offline-repair-test.mjs
npm run test:analytics-gateway
node reviewer-original-probes/independent-recovery-review.cjs
node reviewer-original-probes/evidence-and-lock-probes.cjs
node reviewer-probes/independent-recovery-review.cjs
```

Run these commands only in the reviewed source tree. They use isolated synthetic stores; do not substitute operational paths, run the repair CLI, or run a local-test manifest harness under implementation-only approval. Preserve pipeline exit status if using `tee`.

No dependency changes, generic ingest changes, runtime configuration changes, real job changes, provider calls or new analytics submissions are part of this patch.
