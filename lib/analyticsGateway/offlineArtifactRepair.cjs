'use strict'

// No worker, scheduler, provider, dotenv, or recovery imports. Importing is inert.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { jobsDir } = require('./jobStore.cjs')
const { acquireGatewayMaintenanceStoreOwnership } = require('./gatewayStoreSingleton.cjs')
const { acquireAdvisoryLockHold, jobProcessingMutexSegment } = require('./osAdvisoryLock.cjs')
const { isStoreQuiescent } = require('./localTestCutover.cjs')
const { hashCanonicalArguments } = require('./canonicalJson.cjs')
const { finalizeValidatedJob } = require('./jobValidation.cjs')
const { validateStructuredResult } = require('./resultRetrieval.cjs')
const { validateEnvelopeForJob } = require('./resultEnvelope.cjs')
const { validateDataQualityOperationalGuards } = require('./operationalGuards.cjs')

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i
const HASH = /^[a-f0-9]{64}$/
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const encode = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
function check(value, code) {
  if (!value) throw Object.assign(new Error(code), { code })
}

// Refuse symlinks in every existing path component, not only the final file.
function safePath(file) {
  check(typeof file === 'string' && path.isAbsolute(file), 'absolute_path_required')
  const resolved = path.resolve(file)
  let cursor = path.parse(resolved).root
  for (const part of resolved.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part)
    check(!fs.lstatSync(cursor).isSymbolicLink(), 'symlink_rejected')
  }
  return resolved
}
function readBytes(file) {
  safePath(file)
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stat = fs.fstatSync(fd)
    check(stat.isFile() && stat.nlink === 1 && stat.size <= 32 * 1024 * 1024, 'unsafe_input_file')
    return fs.readFileSync(fd)
  } finally { fs.closeSync(fd) }
}
function readPinned(file, digest, code) {
  check(HASH.test(digest || ''), 'digest_required')
  const bytes = readBytes(file)
  check(sha(bytes) === digest, code)
  return bytes
}
function inside(file, dir) {
  return file === dir || file.startsWith(`${dir}${path.sep}`)
}
function writeExclusive(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600)
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}
function syncDirectory(dir) {
  const fd = fs.openSync(dir, 'r')
  try { fs.fsyncSync(fd) } finally { fs.closeSync(fd) }
}

function storeSnapshot(dir) {
  const result = {}
  for (const name of fs.readdirSync(dir).sort()) {
    if (name === '.os-mutex') {
      check(fs.lstatSync(path.join(dir, name)).isDirectory() &&
        !fs.lstatSync(path.join(dir, name)).isSymbolicLink(), 'unsafe_mutex_directory')
      continue // Stable advisory-lock inodes are never deleted or treated as leases.
    }
    check(name !== 'thread-admission.lock' &&
      !/^\.processing-.*\.lock$/.test(name) &&
      !/^\.jobmut-.*\.lock$/.test(name), 'admission_or_processing_lease_present')
    check(!name.endsWith('.tmp'), 'unfinished_store_write')
    if (name.endsWith('.json') && name !== 'queued-dispatch.signal.json') {
      check(UUID.test(name.slice(0, -5)), 'unknown_store_json')
    }
    result[name] = sha(readBytes(path.join(dir, name)))
  }
  return result
}
function sameSnapshot(expected, actual, excluded = null) {
  const omit = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => k !== excluded))
  check(JSON.stringify(omit(expected)) === JSON.stringify(omit(actual)), 'store_changed')
}

function validateContext(plan, policy, job, target, artifact) {
  const context = plan.execution_context
  check(context?.mode === 'local_test' &&
    context.job_id === policy.jobId &&
    context.request_hash === policy.requestHash &&
    context.idempotency_key === policy.idempotencyKey &&
    context.thread_id === policy.threadId &&
    context.submission_attempt_id === job.submissionAttemptId &&
    typeof job.submissionAttemptId === 'string' && UUID.test(job.submissionAttemptId),
  'execution_context_mismatch')
  check(typeof context.reviewer === 'string' && context.reviewer.trim().length > 0 &&
    context.reviewed_statement === 'Original submission was local_test; not inferred from the mock envelope or artifact.',
  'reviewed_context_required')
  check(Array.isArray(context.references) && context.references.length > 0, 'context_references_required')
  const refs = context.references.map((ref) => {
    check(['submission_log', 'launch_receipt'].includes(ref.kind), 'unsupported_context_reference')
    const file = safePath(ref.path)
    check(!inside(file, jobsDir()) && file !== target && file !== artifact &&
      file !== path.resolve(plan.manifest_path), 'context_reference_not_independent')
    const bytes = readPinned(file, ref.sha256, 'context_digest_mismatch')
    const text = bytes.toString('utf8')
    check(Array.isArray(ref.excerpts) && ref.excerpts.length > 0 &&
      ref.excerpts.every((s) => typeof s === 'string' && s.length > 0 && text.includes(s)),
    'context_excerpt_missing')
    return { ...ref, bytes }
  })
  const excerpts = refs.flatMap((r) => r.excerpts).join('\n')
  // Mechanical coverage is not a substitute for human provenance review.
  // The entire reviewed plan digest must be approved before real execution.
  for (const value of [policy.jobId, policy.idempotencyKey, job.submissionAttemptId, 'local_test']) {
    check(excerpts.includes(value), 'context_identity_not_corroborated')
  }
  return refs
}

function validateConsumer(job, envelope) {
  check(!validateEnvelopeForJob(envelope, job), 'consumer_identity_failed')
  const structured = validateStructuredResult({ job, payload: envelope.result, requireBinding: false })
  check(structured.ok, structured.code || 'consumer_handler_failed')
  const guards = validateDataQualityOperationalGuards(envelope.result, { job, asOf: job.arguments.as_of })
  check(guards.ok, guards.code || 'operational_guards_failed')
  check(envelope.gateway_mode === 'local_test' && envelope.handler_live_gate_status === 'OFF' &&
    envelope.integration_test_passed === true && envelope.production_ready === false,
  'consumer_flags_failed')
}

/**
 * Internal engine. The Q3 CLI supplies a fixed policy; tests use synthetic policies.
 * Approval is an operator gate, not an authentication boundary against a local editor.
 * Never call this API against a real store under implementation/test-only approval.
 */
function repairOfflineArtifact({ planPath, approvedPlanSha256, executionApproved = false, policy }) {
  let hold, processingHold, evidenceDir = null, committed = false
  let stage = 'approval'
  try {
    check(executionApproved === true, 'execution_approval_required')
    const planBytes = readPinned(planPath, approvedPlanSha256, 'plan_digest_mismatch')
    const plan = JSON.parse(planBytes)
    check(plan.schema_version === 'q3_offline_repair_plan_v1', 'plan_schema')
    check(UUID.test(policy?.jobId || '') && HASH.test(policy?.jobSha256 || '') &&
      HASH.test(policy?.artifactSha256 || ''), 'invalid_policy')
    const dir = safePath(plan.jobs_dir)
    check(fs.statSync(dir).isDirectory() && dir === jobsDir(), 'store_context_mismatch')
    const parent = safePath(plan.evidence_parent)
    check(fs.statSync(parent).isDirectory() && !inside(parent, dir), 'unsafe_evidence_parent')
    check(path.resolve(plan.manifest_path) !== path.resolve(plan.artifact_path) &&
      !inside(path.resolve(plan.manifest_path), dir) &&
      !inside(path.resolve(plan.artifact_path), dir) &&
      !inside(path.resolve(planPath), dir), 'unsafe_input_location')
    const target = path.join(dir, `${policy.jobId}.json`)
    stage = 'ownership'
    hold = acquireGatewayMaintenanceStoreOwnership()
    check(hold.ok, hold.code || 'gateway_store_busy')
    processingHold = acquireAdvisoryLockHold(jobProcessingMutexSegment(policy.jobId))
    check(processingHold.ok, 'processing_mutex_busy')

    stage = 'prevalidation'
    const quiescent = isStoreQuiescent(dir)
    check(quiescent.ok, quiescent.reason || 'store_not_quiescent')
    const snapshot = storeSnapshot(dir)
    const before = readPinned(target, policy.jobSha256, 'job_baseline_mismatch')
    const manifest = readPinned(plan.manifest_path, plan.manifest_sha256, 'manifest_digest_mismatch')
    check(JSON.parse(manifest).run_id === plan.manifest_run_id, 'manifest_run_mismatch')
    const artifact = readPinned(plan.artifact_path, policy.artifactSha256, 'artifact_digest_mismatch')
    const job = JSON.parse(before)
    check(job.jobId === policy.jobId && job.operation === policy.operation &&
      job.requestHash === policy.requestHash &&
      hashCanonicalArguments(job.arguments) === policy.requestHash &&
      hashCanonicalArguments(policy.arguments) === policy.requestHash &&
      job.idempotencyKey === policy.idempotencyKey &&
      job.computerThreadId === policy.threadId, 'job_identity_mismatch')
    check(job.state === 'succeeded' && job.resultEnvelope?.gateway_mode === 'mock' &&
      job.resultEnvelope?.provenance?.asset_identity == null, 'not_expected_contaminated_job')
    check(job.gatewayExecutionMode == null || job.gatewayExecutionMode === 'local_test',
      'conflicting_execution_mode')
    check(job.auditHistory == null || Array.isArray(job.auditHistory), 'invalid_audit_history')
    const refs = validateContext(plan, policy, job, target, path.resolve(plan.artifact_path))
    const candidate = { ...job, gatewayExecutionMode: 'local_test' }
    const raw = JSON.parse(artifact)
    check(Object.keys(raw).sort().join(',') === 'gateway_job_binding,handler_result', 'artifact_wrapper_required')
    const asset = { id: policy.assetId, name: `${policy.jobId}.json`,
      entry_id: null, version: null, byte_digest: policy.artifactSha256 }
    const validated = finalizeValidatedJob({
      job: candidate, rawResult: raw, assetIdentity: asset, gatewayMode: 'local_test'
    })
    check(validated.ok, validated.error?.code || 'artifact_validation_failed')
    validateConsumer(candidate, validated.envelope)

    stage = 'evidence'
    evidenceDir = fs.mkdtempSync(path.join(parent, `${policy.jobId}-`))
    fs.chmodSync(evidenceDir, 0o700)
    writeExclusive(path.join(evidenceDir, 'job-before.json'), before)
    writeExclusive(path.join(evidenceDir, 'artifact.json'), artifact)
    writeExclusive(path.join(evidenceDir, 'manifest-before.json'), manifest)
    writeExclusive(path.join(evidenceDir, 'approved-plan.json'), planBytes)
    refs.forEach((ref, i) => writeExclusive(path.join(evidenceDir, `context-${i}.bin`), ref.bytes))
    readPinned(path.join(evidenceDir, 'job-before.json'), policy.jobSha256, 'backup_digest_mismatch')
    readPinned(path.join(evidenceDir, 'artifact.json'), policy.artifactSha256, 'backup_digest_mismatch')
    const event = {
      type: 'historical_q3_offline_repair', at: new Date().toISOString(),
      repair_id: path.basename(evidenceDir), recovery_method: 'offline_verified_artifact_import',
      original_automatic_delivery_proven: false,
      before_job_sha256: policy.jobSha256, artifact_sha256: policy.artifactSha256,
      recorded_original_asset_id: policy.assetId, evidence_directory: evidenceDir,
      approved_plan_sha256: approvedPlanSha256,
      manifest_sha256: plan.manifest_sha256,
      context_reference_sha256s: refs.map((r) => r.sha256)
    }
    const next = { ...candidate, state: validated.state, resultEnvelope: validated.envelope,
      error: null, updatedAt: event.at, auditHistory: [...(job.auditHistory || []), event] }
    // All other fields, including attempt IDs, retry counters, keys and times, remain as-is.
    const nextBytes = encode(next)
    const receipt = { schema_version: 'q3_offline_repair_receipt_v1', ...event,
      after_job_sha256: sha(nextBytes), artifact_binding_validation: 'pass',
      consumer_validation: 'pass', certification_warnings: validated.envelope.certification_warnings,
      provider_calls: 0, submissions: 0, gateway_started: false,
      admission_cleanup: 'none; any admission/processing lease blocks execution' }
    writeExclusive(path.join(evidenceDir, 'prepared-receipt.json'), encode({ ...receipt, committed: false }))
    syncDirectory(evidenceDir)

    stage = 'commit'
    readPinned(planPath, approvedPlanSha256, 'plan_changed')
    readPinned(plan.manifest_path, plan.manifest_sha256, 'manifest_changed')
    readPinned(plan.artifact_path, policy.artifactSha256, 'artifact_changed')
    refs.forEach((r) => readPinned(r.path, r.sha256, 'context_changed'))
    sameSnapshot(snapshot, storeSnapshot(dir))
    readPinned(target, policy.jobSha256, 'job_changed')
    check(isStoreQuiescent(dir).ok, 'store_not_quiescent')
    const temp = path.join(dir, `.${policy.jobId}.${crypto.randomUUID()}.tmp`)
    try {
      writeExclusive(temp, nextBytes)
      fs.renameSync(temp, target) // One replacement; no intermediate queued/validating state.
      committed = true
    } finally { if (!committed && fs.existsSync(temp)) fs.unlinkSync(temp) }
    syncDirectory(dir)

    stage = 'readback'
    const after = readPinned(target, receipt.after_job_sha256, 'readback_digest_mismatch')
    validateConsumer(JSON.parse(after), JSON.parse(after).resultEnvelope)
    sameSnapshot(snapshot, storeSnapshot(dir), `${policy.jobId}.json`)
    readPinned(plan.manifest_path, plan.manifest_sha256, 'manifest_changed_after_commit')
    stage = 'receipt'
    const receiptTemp = path.join(evidenceDir, '.receipt.tmp')
    writeExclusive(receiptTemp, encode({ ...receipt, committed: true, status: 'PASS' }))
    fs.renameSync(receiptTemp, path.join(evidenceDir, 'receipt.json'))
    syncDirectory(evidenceDir)
    return { ok: true, status: 'PASS', committed: true, evidence_directory: evidenceDir,
      before_job_sha256: policy.jobSha256, after_job_sha256: receipt.after_job_sha256 }
  } catch (error) {
    // Never rollback to the contaminated record, retry, dispatch, or start a gateway.
    return { ok: false, status: 'CHECKPOINT', code: error.code || 'repair_failed',
      stage, committed, evidence_directory: evidenceDir }
  } finally {
    try { if (processingHold?.ok) processingHold.release() }
    finally { if (hold?.ok) hold.release() }
  }
}

module.exports = { repairOfflineArtifact }
