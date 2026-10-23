const fs = require('fs')
const path = require('path')
const { jobsDir, listQueuedJobsForDispatch } = require('./jobStore.cjs')
const { acquireGatewayMaintenanceStoreOwnership } = require('./gatewayStoreSingleton.cjs')
const { readLock } = require('./jobAdmission.cjs')

const JOB_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i

const TERMINAL_JOB_STATES = new Set(['succeeded', 'failed', 'validation_failed'])

const ACTIVE_JOB_STATES = new Set([
  'queued',
  'running',
  'processing',
  'validating',
  'awaiting_artifact',
  'submission_uncertain',
  'delivery_failed',
  'needs_auth',
  'needs_input'
])

function classifyJobState(state) {
  if (typeof state !== 'string' || !state) return 'malformed'
  if (TERMINAL_JOB_STATES.has(state)) return 'terminal'
  if (ACTIVE_JOB_STATES.has(state)) return 'active'
  return 'unknown'
}

function isStoreQuiescent(customJobsDir = null) {
  const dir = customJobsDir || jobsDir()
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => JOB_FILE_RE.test(f))
  } catch {
    return { ok: false, reason: 'store_unreadable', active: [], issues: [{ code: 'store_unreadable' }] }
  }

  const active = []
  const issues = []
  for (const file of files) {
    const full = path.join(dir, file)
    let job
    try {
      job = JSON.parse(fs.readFileSync(full, 'utf8'))
    } catch {
      issues.push({ code: 'malformed_job_record', file })
      active.push({ jobId: file.replace(/\.json$/, ''), state: 'malformed' })
      continue
    }
    if (!job || typeof job !== 'object' || Array.isArray(job) ||
        job.jobId !== file.replace(/\.json$/, '')) {
      issues.push({ code: 'malformed_job_record', file })
      continue
    }
    const classification = classifyJobState(job.state)
    if (classification === 'malformed') {
      issues.push({ code: 'malformed_job_record', jobId: job.jobId || file })
      active.push({ jobId: job.jobId || file, state: job.state ?? null })
      continue
    }
    if (classification === 'unknown') {
      issues.push({ code: 'unknown_job_state', jobId: job.jobId, state: job.state })
      active.push({ jobId: job.jobId, state: job.state })
      continue
    }
    if (classification === 'active') {
      active.push({ jobId: job.jobId, state: job.state })
    }
  }

  if (issues.length > 0 || active.length > 0) {
    return {
      ok: false,
      reason: issues[0]?.code || 'store_not_quiescent',
      active,
      issues
    }
  }
  return { ok: true, active: [], issues: [] }
}

function inspectCutoverState() {
  try {
    const quiescent = isStoreQuiescent()
    if (!quiescent.ok) return { ...quiescent, quiescent }
    const admission = readLock()
    if (!admission && fs.existsSync(path.join(jobsDir(), 'thread-admission.lock'))) {
      return { ok: false, reason: 'thread_admission_unreadable' }
    }
    if (admission?.jobId) {
      return { ok: false, reason: 'thread_admission_active', jobId: admission.jobId }
    }
    if (admission) return { ok: false, reason: 'thread_admission_malformed' }
    const pendingQueued = listQueuedJobsForDispatch()
    if (pendingQueued.length > 0) {
      return {
        ok: false,
        reason: 'pending_queue_admissions',
        pending: pendingQueued.map((j) => j.jobId)
      }
    }

    return { ok: true, quiescent }
  } catch { return { ok: false, reason: 'store_inspection_failed' } }
}

function acquireCutoverOwnership(customJobsDir) {
  if (customJobsDir && path.resolve(customJobsDir) !== jobsDir()) {
    return { ok: false, reason: 'store_context_mismatch' }
  }
  // Do not let lock-directory creation turn a missing store into an empty store.
  try {
    if (!fs.lstatSync(jobsDir()).isDirectory()) return { ok: false, reason: 'store_unreadable' }
    const hold = acquireGatewayMaintenanceStoreOwnership()
    if (!hold.ok) return { ok: false, reason: 'gateway_store_not_exclusively_owned', code: hold.code }
    return hold
  } catch { return { ok: false, reason: 'store_ownership_failed' } }
}

// Scope includes final checks AND the caller's synchronous or awaited work.
// No reusable authorization token is returned after releasing this hold.
async function withCutoverStoreOwnership(callback, customJobsDir = null) {
  const hold = acquireCutoverOwnership(customJobsDir)
  if (!hold.ok) return hold
  try {
    const guard = inspectCutoverState()
    if (!guard.ok) return guard
    return await callback(guard)
  } finally { hold.release() }
}

// Compatibility helper for read-only diagnostics. NOT permission for a later restart.
function evaluateCutoverGuard(customJobsDir = null) {
  const hold = acquireCutoverOwnership(customJobsDir)
  if (!hold.ok) return hold
  try {
    return { ...inspectCutoverState(), preflightOnly: true, restoreAuthorized: false }
  } finally { hold.release() }
}

/**
 * Pure preflight predicate (legacy name retained for compatibility).
 * This result is not authorization for a later mock restoration.
 * Inherited environment flags never authorize restoration.
 */
function shouldRestoreMockGateway({
  runExitCode,
  evidenceValidation,
  storeQuiescent,
  cutoverGuard
}) {
  if (runExitCode !== 0) return { ok: false, reason: 'nonzero_exit' }
  if (!evidenceValidation || evidenceValidation.ok !== true) {
    return {
      ok: false,
      reason: evidenceValidation?.code || 'validation_evidence_missing'
    }
  }
  if (storeQuiescent !== true) return { ok: false, reason: 'store_not_quiescent' }
  if (!cutoverGuard || cutoverGuard.ok !== true) {
    return { ok: false, reason: cutoverGuard?.reason || 'cutover_guard_failed' }
  }
  return { ok: true, preflightOnly: true, restoreAuthorized: false }
}

function blockedRestoreReasonForCheckpoint(checkpointCode) {
  const blocked = new Set([
    'terminal_failure',
    'timeout',
    'validation_failed',
    'submit_rejected',
    'manifest_missing',
    'missing_token'
  ])
  if (blocked.has(checkpointCode)) return checkpointCode
  if (checkpointCode === 'terminal_failure') return 'submission_uncertain_or_failure'
  return null
}

module.exports = {
  isStoreQuiescent,
  evaluateCutoverGuard,
  withCutoverStoreOwnership,
  shouldRestoreMockGateway,
  blockedRestoreReasonForCheckpoint,
  ACTIVE_JOB_STATES,
  TERMINAL_JOB_STATES,
  classifyJobState
}
