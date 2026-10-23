const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { hashCanonicalArguments, canonicalJsonString } = require('./canonicalJson.cjs')

const DEFAULT_MANIFEST_PATH = path.join(
  __dirname,
  '..',
  '..',
  'data',
  'analytics-gateway',
  'local-test-run-manifest.json'
)

const APPROVED_ENTRIES_TEMPLATE = [
  {
    entry_id: 'sales_trends_sep_vs_aug',
    operation: 'bevvi_period_comparison',
    arguments: {
      as_of: '2026-10-02',
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      comparison: 'custom',
      baseline_start: '2026-08-01',
      baseline_end: '2026-08-31',
      group_by: 'segment'
    }
  },
  {
    entry_id: 'customer_analysis_jul_sep',
    operation: 'bevvi_customer_trends',
    arguments: {
      as_of: '2026-10-02',
      start_date: '2026-07-01',
      end_date: '2026-09-30'
    }
  },
  {
    entry_id: 'planning_forecast_30d',
    operation: 'bevvi_planning_forecast',
    arguments: {
      as_of: '2026-10-02',
      model: 'planning_blend_v1'
    }
  }
]

function manifestPath() {
  return path.resolve(
    process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_MANIFEST_PATH || DEFAULT_MANIFEST_PATH
  )
}

function isLocalTestModeEnabled() {
  return (
    String(process.env.BEVVI_ANALYTICS_GATEWAY_MODE || '').toLowerCase() === 'local_test' &&
    process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ENABLE === 'true'
  )
}

function allowedLocalTestClientId() {
  return String(process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_CLIENT_ID || 'default')
}

function newRunId() {
  return crypto.randomUUID()
}

function newIdempotencyKey(entryId) {
  return `approved-local-test-2026-10-04-${entryId}-${crypto.randomUUID()}`
}

function buildFreshManifest({ clientId = allowedLocalTestClientId() } = {}) {
  const runId = newRunId()
  return {
    schema_version: 'local_test_manifest_v1',
    run_id: runId,
    created_at: new Date().toISOString(),
    allowed_client_id: clientId,
    entries: APPROVED_ENTRIES_TEMPLATE.map((entry) => ({
      ...entry,
      arguments_hash: hashCanonicalArguments(entry.arguments),
      idempotency_key: newIdempotencyKey(entry.entry_id),
      job_id: null,
      submission_marked_at: null,
      submission_attempted: false
    })),
    submissions_attempted: 0
  }
}

function readManifest() {
  const file = manifestPath()
  if (!fs.existsSync(file)) return null
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeManifestAtomic(manifest) {
  const file = manifestPath()
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  fs.writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
}

function persistFreshManifest(options) {
  const manifest = buildFreshManifest(options)
  writeManifestAtomic(manifest)
  return manifest
}

function findManifestEntry(manifest, { operation, normalizedArgs, idempotencyKey }) {
  const argsHash = hashCanonicalArguments(normalizedArgs)
  return manifest.entries.find(
    (entry) =>
      entry.operation === operation &&
      entry.arguments_hash === argsHash &&
      entry.idempotency_key === idempotencyKey
  )
}

function validateLocalTestSubmission({ clientId, operation, normalizedArgs, idempotencyKey }) {
  if (!isLocalTestModeEnabled()) {
    return { ok: false, code: 'local_test_disabled', message: 'Local test mode is not enabled' }
  }
  if (!idempotencyKey) {
    return { ok: false, code: 'idempotency_required', message: 'idempotency_key required in local_test mode' }
  }
  const manifest = readManifest()
  if (!manifest) {
    return { ok: false, code: 'manifest_missing', message: 'Local test manifest not found' }
  }
  if (clientId !== manifest.allowed_client_id) {
    return {
      ok: false,
      code: 'local_test_client_forbidden',
      message: 'Client identity is not authorized for this local test run'
    }
  }

  const entry = findManifestEntry(manifest, { operation, normalizedArgs, idempotencyKey })
  if (!entry) {
    return {
      ok: false,
      code: 'local_test_request_forbidden',
      message: 'Request is not an exact approved local test manifest entry'
    }
  }

  if (entry.job_id && entry.submission_attempted) {
    return { ok: true, entry, replay: true, jobId: entry.job_id }
  }

  if (manifest.submissions_attempted >= 3 && !entry.submission_attempted) {
    return {
      ok: false,
      code: 'local_test_submission_cap',
      message: 'Approved local test run allows at most three submissions'
    }
  }

  return { ok: true, entry, replay: false }
}

function markLocalTestSubmissionAttempted({ operation, normalizedArgs, idempotencyKey, jobId }) {
  const manifest = readManifest()
  if (!manifest) {
    throw new Error('Local test manifest missing during submission mark')
  }
  const entry = findManifestEntry(manifest, { operation, normalizedArgs, idempotencyKey })
  if (!entry) {
    throw new Error('Manifest entry missing during submission mark')
  }
  const next = JSON.parse(JSON.stringify(manifest))
  const target = findManifestEntry(next, { operation, normalizedArgs, idempotencyKey })
  if (!target.submission_attempted) {
    next.submissions_attempted += 1
    target.submission_attempted = true
    target.submission_marked_at = new Date().toISOString()
  }
  target.job_id = jobId
  writeManifestAtomic(next)
}

module.exports = {
  APPROVED_ENTRIES_TEMPLATE,
  manifestPath,
  isLocalTestModeEnabled,
  allowedLocalTestClientId,
  buildFreshManifest,
  persistFreshManifest,
  readManifest,
  writeManifestAtomic,
  validateLocalTestSubmission,
  markLocalTestSubmissionAttempted,
  findManifestEntry,
  canonicalJsonString
}
