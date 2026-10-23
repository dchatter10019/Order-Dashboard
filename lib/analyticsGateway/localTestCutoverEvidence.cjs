const fs = require('fs')
const os = require('os')
const path = require('path')
const crypto = require('crypto')
const { readJob, jobsDir } = require('./jobStore.cjs')
const { readManifest, manifestPath } = require('./localTestManifest.cjs')
const { canonicalJsonString, hashCanonicalArguments } = require('./canonicalJson.cjs')
const { validateEnvelopeForJob } = require('./resultEnvelope.cjs')

const EVIDENCE_SCHEMA = 'local_test_cutover_evidence_v2'
const CONTEXT_ENV = 'BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_CUTOVER_CONTEXT'
const PATH_ENV = 'BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_CUTOVER_EVIDENCE_PATH'
const digest = (value) => crypto.createHash('sha256').update(canonicalJsonString(value)).digest('hex')
const fail = (code) => ({ ok: false, code, message: code.replaceAll('_', ' ') })
const same = (a, b) => canonicalJsonString(a) === canonicalJsonString(b)
const nonempty = (value) => typeof value === 'string' && value.length > 0

function snapshotManifest(manifest) {
  if (manifest?.schema_version !== 'local_test_manifest_v1' ||
      !nonempty(manifest.run_id) || !nonempty(manifest.allowed_client_id) ||
      !Array.isArray(manifest.entries) || !manifest.entries.length) {
    throw new Error('Invalid cutover manifest')
  }
  const entries = manifest.entries.map((entry) => {
    if (!nonempty(entry.entry_id) || !nonempty(entry.operation) ||
        !nonempty(entry.idempotency_key) || !entry.arguments ||
        entry.arguments_hash !== hashCanonicalArguments(entry.arguments)) {
      throw new Error('Invalid cutover manifest entry')
    }
    return {
      entry_id: entry.entry_id, operation: entry.operation,
      arguments: entry.arguments, request_hash: entry.arguments_hash,
      idempotency_key: entry.idempotency_key, job_id: entry.job_id || null
    }
  })
  if (new Set(entries.map(e => e.entry_id)).size !== entries.length ||
      new Set(entries.map(e => e.idempotency_key)).size !== entries.length) {
    throw new Error('Duplicate cutover manifest entry')
  }
  return JSON.parse(JSON.stringify({
    run_id: manifest.run_id, client_id: manifest.allowed_client_id, entries
  }))
}

// Parent-only: never reuse an inherited receipt path, invocation, or nonce.
function createCutoverInvocation() {
  const snapshot = snapshotManifest(readManifest())
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bevvi-cutover-evidence-'))
  fs.chmodSync(directory, 0o700)
  const invocation = {
    schema_version: 'local_test_cutover_invocation_v1',
    nonce: crypto.randomBytes(32).toString('hex'),
    started_at: new Date().toISOString(),
    jobs_dir: jobsDir(), manifest_path: manifestPath(),
    evidence_file: path.join(directory, 'receipt.json'), snapshot
  }
  return {
    invocation,
    childEnv: { [CONTEXT_ENV]: JSON.stringify(invocation), [PATH_ENV]: invocation.evidence_file },
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }) }
  }
}

function invocationFromEnv() {
  try { return JSON.parse(process.env[CONTEXT_ENV] || 'null') } catch { return null }
}

function evidencePath() {
  const file = process.env[PATH_ENV]
  return nonempty(file) ? path.resolve(file) : null
}

function validateInvocationManifest(invocation, { completed = false } = {}) {
  try {
    if (invocation?.schema_version !== 'local_test_cutover_invocation_v1' ||
        !/^[a-f0-9]{64}$/.test(invocation.nonce || '') ||
        !Number.isFinite(Date.parse(invocation.started_at)) ||
        invocation.jobs_dir !== jobsDir() || invocation.manifest_path !== manifestPath()) {
      return fail('invocation_missing_or_mismatched')
    }
    const current = snapshotManifest(readManifest())
    const expected = invocation.snapshot
    if (current.run_id !== expected.run_id || current.client_id !== expected.client_id ||
        current.entries.length !== expected.entries.length) return fail('manifest_changed')
    for (const entry of expected.entries) {
      const actual = current.entries.find(e => e.entry_id === entry.entry_id)
      if (!actual) return fail('manifest_changed')
      const { job_id: beforeId, ...before } = entry
      const { job_id: afterId, ...after } = actual
      if (!same(before, after) || (beforeId && beforeId !== afterId) ||
          (completed && !afterId)) return fail('manifest_changed')
    }
    return { ok: true, current }
  } catch { return fail('manifest_unreadable_or_invalid') }
}

function buildCutoverEvidence({ runId, validatedAt, expectedJobs, invocation = invocationFromEnv() }) {
  const body = {
    schema_version: EVIDENCE_SCHEMA,
    invocation_nonce: invocation?.nonce || null,
    run_id: runId, validated_at: validatedAt || new Date().toISOString(),
    expected_jobs: expectedJobs || []
  }
  return { ...body, validation_digest: digest(body) }
}

function writeCutoverEvidenceAtomic(evidence) {
  const invocation = invocationFromEnv()
  const file = evidencePath()
  if (!file || file !== invocation?.evidence_file ||
      evidence.invocation_nonce !== invocation?.nonce) return fail('evidence_context_missing')
  // Parent allocated a private unique directory. Exclusive create forbids reuse.
  // Parent reads only after this synchronous writer's process exits successfully.
  try {
    fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    return { ok: true, path: file }
  } catch { return fail('evidence_write_failed') }
}

function validateCutoverEvidence({ invocation, nowMs = Date.now() } = {}) {
  if (!invocation) return fail('invocation_missing')
  const manifest = validateInvocationManifest(invocation, { completed: true })
  if (!manifest.ok) return manifest
  try {
    const stat = fs.lstatSync(invocation.evidence_file)
    if (!stat.isFile() || stat.isSymbolicLink()) return fail('evidence_unreadable')
    const evidence = JSON.parse(fs.readFileSync(invocation.evidence_file, 'utf8'))
    if (evidence?.schema_version !== EVIDENCE_SCHEMA) return fail('evidence_schema_mismatch')
    if (evidence.invocation_nonce !== invocation.nonce ||
        evidence.run_id !== invocation.snapshot.run_id) return fail('evidence_invocation_mismatch')
    const timestamp = Date.parse(evidence.validated_at)
    if (!Number.isFinite(timestamp) || timestamp < Date.parse(invocation.started_at) ||
        timestamp > nowMs + 1000) return fail('evidence_stale')
    const { validation_digest, ...body } = evidence
    if (validation_digest !== digest(body)) return fail('evidence_digest_mismatch')
    const rows = evidence.expected_jobs
    const expected = manifest.current.entries
    if (!Array.isArray(rows) || rows.length !== expected.length ||
        new Set(rows.map(r => r?.entry_id)).size !== expected.length ||
        new Set(rows.map(r => r?.job_id)).size !== expected.length) {
      return fail('evidence_job_set_mismatch')
    }
    for (const entry of expected) {
      const row = rows.find(r => r?.entry_id === entry.entry_id)
      if (!row || row.job_id !== entry.job_id || row.operation !== entry.operation ||
          row.request_hash !== entry.request_hash) return fail('evidence_job_mismatch')
      if (!same(row.validation, {
        consumer: true, artifact: true, operational: true, integration: true
      })) return fail('evidence_validation_incomplete')
      const job = readJob(entry.job_id)
      const envelope = job?.resultEnvelope
      if (!job || job.state !== 'succeeded' || job.gatewayExecutionMode !== 'local_test' ||
          job.clientId !== manifest.current.client_id || job.idempotencyKey !== entry.idempotency_key ||
          job.operation !== entry.operation || job.requestHash !== entry.request_hash ||
          !same(job.arguments, entry.arguments) || !envelope ||
          envelope.gateway_mode !== 'local_test' || envelope.integration_test_passed !== true ||
          validateEnvelopeForJob(envelope, job)) return fail('evidence_job_not_validated')
      const asset = envelope.provenance?.asset_identity
      if (!asset?.id || !/^[a-f0-9]{64}$/.test(asset.byte_digest || '') ||
          row.artifact_sha256 !== asset.byte_digest ||
          row.envelope_sha256 !== digest(envelope)) return fail('evidence_result_mismatch')
    }
    return { ok: true, runId: evidence.run_id, expectedJobs: rows }
  } catch { return fail('evidence_missing_or_unreadable') }
}

module.exports = {
  EVIDENCE_SCHEMA, evidencePath, createCutoverInvocation, invocationFromEnv,
  validateInvocationManifest, buildCutoverEvidence, writeCutoverEvidenceAtomic,
  validateCutoverEvidence, digest
}
