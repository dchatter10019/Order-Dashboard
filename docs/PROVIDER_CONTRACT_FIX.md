# Bevvi Analytics Gateway: Provider Fix Applied

Applied offline October 4, 2026 to the uploaded source ZIP `ec00e2076f9d3388c1c4bdf3e27b1191f25410ad86b035d092dd67f8c9ecfa0a`. The adapter now follows the reviewed provider contract, and the standalone capture is bounded and read-only. This copy is not deployed and does not update the Mac checkout automatically.

## Implementation

- **Pagination:** only `thread_id` and opaque `cursor` are sent. Strict `assets` plus explicit `next_cursor` parsing replaces guessed aliases; short or empty pages continue when a cursor exists. Null terminates regardless of length. Repeated cursors/pages and unresolved page caps fail closed.
- **Errors:** MCP rejection, malformed response and transport errors retain distinct safe codes instead of becoming missing artifacts. Detailed upstream exception text and raw cursors are not persisted.
- **Admission:** provider metadata failures preserve unresolved remote-task admission as `delivery_failed`; authentication checkpoints remain `needs_auth`. Artifact-only reconciliation can recheck `delivery_failed`; no remote resubmission was added.
- **Capture authorization:** the standalone capture reads an existing unexpired access token only. It supplies no SDK auth provider or credential-write callbacks, does not register/refresh/sign in, refuses redirects and off-endpoint requests, and stops on authorization errors.
- **Capture evidence:** discovery and asset-list calls are bounded. Only the fixed thread and two metadata tools are used. A complete listing and unique exact filename/asset match are required before one download-metadata request. The script never fetches an artifact body.
- **Redaction:** cursor hashes replace raw values, unrelated asset rows are omitted, matched target identity is narrowly retained, signed URLs are reduced to hostname/scheme/port, and evidence checksums cover actual saved bytes.

The download allowlist, native lock implementation, maintenance singleton fix, exact reviewer schema and dependencies are unchanged. One older mock asset response was updated to include the provider-required `next_cursor: null`; no existing assertion was weakened.

## Validation

`npm run test:analytics-gateway` runs 17 suites, including a new provider-contract suite with 16 focused checks. All run without provider connections, token reads, operational state or artifact body downloads. The CLI itself was not executed against the provider.

The new checks cover exact request fields and cursor propagation, short/empty/full terminal pages, malformed/missing continuation, repeats and caps, duplicate matches, provider-error propagation, target binding, privacy redaction, bounded discovery, read-only transport policy and retained admission on delivery failure. Existing suites and earlier independent regressions are recorded in `review-export/analytics-gateway/PROVIDER_FIX_VERIFICATION.json`.

Environment: Linux x64, Node 20.20.1, fs-ext 2.0.0 using the prior isolated native build. The original independent kit retains its known 9/10 direct-lock completion-bypass caveat; no Mac test claim is made for this copy.

## Local application

The source ZIP is a review bundle, not the entire dashboard repository. Prefer the companion patch, which includes changes and newly added files:

```bash
cd "/Users/dipanjan/Bevvi Dashboard/Order-Dashboard"
git apply --check "/path/to/bevvi-provider-contract-fix.patch"
git apply "/path/to/bevvi-provider-contract-fix.patch"
npm run test:analytics-gateway
```

Replace the patch path with the extracted file location. If the check fails, stop and reconcile the bounded diff; do not reset unrelated work or overwrite the checkout. Do not run the read-only capture script as part of this offline test command.

## Remaining gates

The captured exact hostname `d2z0o16i8xm8ak.cloudfront.net` is observed, not approved. No allowlist setting was written. Applying this patch is not permission to download from that host.

A fresh read-only capture using the corrected client should precede any separately approved end-to-end analytics smoke. Provider checks, artifact-host approval, live smoke, migration, deployment, production enablement and Git push remain distinct actions. No live job, OAuth mutation, cache refresh, forecast change or EC2 operation occurred during this repair.
