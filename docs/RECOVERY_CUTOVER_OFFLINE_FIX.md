# Bevvi Analytics Gateway: Offline Cutover Fix

Implemented October 4, 2026 in an isolated Computer workspace, against uploaded archive SHA-256 `048b07a751c77bba5daab6f3b83da2b2e7535058519b8ad18436266e4241aae4`. This does not install changes into the Mac checkout or authorize any live action.

## Scope

Only the remaining current-invocation evidence and full-duration cutover ownership findings were repaired. Q3, real manifests/receipts/artifacts, OAuth, `.env`, caches, registries, and forecast snapshots were not modified. There were no provider calls, new calculations, operational gateway restarts, commits, pushes, or deployment.

## Current-invocation evidence

- Parent validates and snapshots the complete approved manifest before launching the harness.
- Each invocation receives a fresh cryptographic nonce and a private, unique temporary evidence directory. Inherited context, paths, and success flags cannot substitute for that invocation.
- Child checks the manifest/context before any MCP submission, then writes evidence schema `local_test_cutover_evidence_v2` only after successful validation.
- The receipt includes the nonce, run ID, validation time, complete unique entry/job set, operation/request hashes, explicit per-job validation checks, artifact digest, and consumer-envelope digest.
- Parent requires the manifest to remain compatible with the initial snapshot and the completed job identities. It rejects replay, stale/invalid timestamps, incomplete/duplicate job sets, wrong hashes, missing attestations, and changed result digests.
- Generic `succeeded` is not enough: stored mode, client/key/request identity, live consumer envelope, integration flag, and artifact identity must also match.
- Receipt creation is exclusive within the parent-created private directory. Parent only reads after the child exits; a failed/interrupted writer cannot authorize preflight. The directory is removed in the parent's `finally`.

## Continuous ownership and truthful preflight

`withCutoverStoreOwnership(callback)` uses the existing maintenance singleton and holds it across store, admission and queue inspection plus the caller's entire synchronous or awaited callback. Release occurs in `finally`, including exceptions. Tests demonstrate that a separate process cannot acquire ownership during the callback or after an `await`.

The actual wrapper runs its evidence validation inside that ownership scope. It never stops or starts an operational server.

### Important command semantics

- `analytics-gateway-local-test-cutover-run.mjs --preflight` runs the manifest harness, then performs guarded preflight. **It is not an offline test command and must not be invoked during patch application.**
- `--restore-mock` remains a deprecated alias for that preflight behavior, not a restart operation.
- Output is `preflight_passed` or `preflight_blocked`, always with `restore_authorized: false`. A later executor must obtain its own ownership and redo final checks through the actual transition.
- If the operational server still holds the store, the guard blocks. This patch does not stop it automatically.
- The production command no longer accepts `--child-fixture`; offline tests inject their synthetic child externally.
- Direct invocation of the manifest harness without a parent-created invocation fails before submission. No existing manifest is reset or expanded by these changes.

## Verification

Executed on Linux, Node v20.20.1, fs-ext 2.0.0, MCP SDK 1.32.0, with reused sandbox dependencies:

- `npm run test:analytics-gateway`: 22/22 suites pass.
- New `analytics-gateway-cutover-evidence-test.mjs`: 35 targeted checks pass, included in that chain.
- Original reviewer assertion runner: 9/9 pass.
- Receipt/ownership boundary runner: 4/4 pass.
- Cursor-recreated runner: 10/10 pass, clearly labeled separately from original evidence.

The original nine-check assertion runner remains byte-identical. Its external synthetic preload now supplies the required parent manifest and new receipt protocol. The boundary fixture uses canonical argument hashes and seeds stale receipts as raw test files; its four safety expectations are unchanged. The new targeted suite additionally writes wrong-nonce/run/partial receipts into a legitimate current destination, so passing solely because the old evidence path is ignored is insufficient.

The supplied SDK suite uses a temporary synthetic loopback server. No operational gateway or live provider is involved. Repeat the offline tests on the user's Darwin/Node environment after applying.

## Evidence provenance

`reviewer-original-probes/pre-fix-actual-results.json` is the actual original captured 2-pass/7-fail baseline. The earlier reconstructed baseline has been replaced by a correction notice, not described as original output.

Old captured outputs remain named `original-results.json` and `boundary-results.json`; current outputs are `current-original-results.json` and `current-boundary-results.json`.

## Q3

Job `6a529ed9-0f69-422f-a9c9-e6c52da717ad` remains untouched. Its original artifact already exists; no new forecast is necessary. Correcting the contaminated historical local job still requires a separate approved repair procedure.
