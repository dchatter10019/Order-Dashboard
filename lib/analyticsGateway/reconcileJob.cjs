const { readJob, updateJob } = require('./jobStore.cjs')
const { getRuntimeMode } = require('./modes.cjs')
const { appendAudit, finalizeValidatedJob } = require('./jobValidation.cjs')
const { readLock } = require('./jobAdmission.cjs')
const { completeThreadAdmissionForJob } = require('./admissionDispatch.cjs')
const { PROVIDER_DELIVERY_ERRORS } = require('./providerContract.cjs')
const {
  assertProcessModeCompatibleWithJob,
  gatewayModeForJobFinalization
} = require('./jobExecutionContext.cjs')

const TERMINAL_STATES = new Set(['succeeded', 'validation_failed', 'failed'])
const NON_FORCE_RECONCILE_STATES = new Set([
  'submission_uncertain',
  'validating',
  'awaiting_artifact',
  'delivery_failed'
])

let __testOnlyPauseAfterReconcileJobRead = null
let __testOnlyFetchJobBoundArtifact = null

function __testOnlySetPauseAfterReconcileJobRead(hook) {
  __testOnlyPauseAfterReconcileJobRead = hook
}

function __testOnlySetFetchJobBoundArtifact(fn) {
  __testOnlyFetchJobBoundArtifact = fn
}

function admissionOwnerForJob(jobId) {
  const lock = readLock()
  if (lock?.jobId === jobId) return lock.ownerId || null
  const job = readJob(jobId)
  return job?.processingOwnerId || null
}

async function applyArtifactValidation(jobId, upstream, auditHistory) {
  if (!upstream.ok) {
    const pendingCodes = new Set(['missing_result', 'awaiting_artifact', 'ambiguous_asset'])
    const job = readJob(jobId)
    const nextState = pendingCodes.has(upstream.code) ? 'awaiting_artifact'
      : upstream.code === 'needs_auth' ? 'needs_auth'
        : upstream.artifactDeliveryError || PROVIDER_DELIVERY_ERRORS.has(upstream.code) ? 'delivery_failed' : 'validation_failed'
    updateJob(jobId, {
      state: nextState,
      error: { code: upstream.code, message: upstream.message },
      auditHistory: appendAudit(job || { auditHistory }, {
        event: 'reconcile_failed',
        code: upstream.code
      })
    })
    if (nextState === 'validation_failed') {
      completeThreadAdmissionForJob(jobId, nextState, admissionOwnerForJob(jobId))
    }
    return upstream
  }

  const jobForFinalize = readJob(jobId)
  const finalGatewayMode = gatewayModeForJobFinalization(jobForFinalize, upstream)
  if (!finalGatewayMode) {
    const failing = readJob(jobId)
    updateJob(jobId, {
      state: 'validation_failed',
      error: {
        code: 'execution_context_missing',
        message: 'Missing or incompatible persisted execution mode for reconciliation'
      },
      auditHistory: appendAudit(failing || { auditHistory }, {
        event: 'validation_failed',
        code: 'execution_context_missing'
      })
    })
    completeThreadAdmissionForJob(jobId, 'validation_failed', admissionOwnerForJob(jobId))
    return {
      ok: false,
      code: 'execution_context_missing',
      message: 'Missing or incompatible persisted execution mode for reconciliation'
    }
  }

  const finalized = finalizeValidatedJob({
    job: jobForFinalize,
    rawResult: upstream.payload,
    assetIdentity: upstream.assetIdentity,
    gatewayMode: finalGatewayMode
  })

  if (!finalized.ok) {
    const failing = readJob(jobId)
    updateJob(jobId, {
      state: finalized.state,
      error: finalized.error,
      auditHistory: appendAudit(failing || { auditHistory }, {
        event: 'validation_failed',
        error: finalized.error,
        asset_identity: upstream.assetIdentity
      })
    })
    completeThreadAdmissionForJob(jobId, finalized.state, admissionOwnerForJob(jobId))
    return finalized
  }

  const validatedJob = readJob(jobId)
  updateJob(jobId, {
    state: finalized.state,
    resultEnvelope: finalized.envelope,
    error: null,
    waitingForThreadAdmission: false,
    auditHistory: appendAudit(validatedJob || { auditHistory }, {
      event: 'reconcile_validated',
      asset_identity: upstream.assetIdentity,
      certification_warnings: finalized.validation.certification_warnings
    })
  })

  completeThreadAdmissionForJob(jobId, finalized.state, admissionOwnerForJob(jobId))

  return {
    ok: true,
    jobId,
    reconciled: true,
    envelope: finalized.envelope,
    assetIdentity: upstream.assetIdentity,
    validation: finalized.validation
  }
}

/**
 * Reconcile by job-bound asset fetch only (no new Computer calculation).
 * --force: terminal jobs only; still runs full identity + operational validation.
 */
async function reconcileGatewayJob(jobId, options = {}) {
  const { forceRevalidate = false } = options
  const { acquireGatewayMaintenanceStoreOwnership } = require('./gatewayStoreSingleton.cjs')
  const store = acquireGatewayMaintenanceStoreOwnership()
  if (!store.ok) return store

  try {
    const job = readJob(jobId)
    if (__testOnlyPauseAfterReconcileJobRead) {
      await __testOnlyPauseAfterReconcileJobRead({ jobId, job })
    }
    if (!job) return { ok: false, code: 'not_found', message: 'Job not found' }

    const compat = assertProcessModeCompatibleWithJob(job, getRuntimeMode())
    if (!compat.ok) {
      return { ok: false, code: compat.code, message: compat.message }
    }

    if (forceRevalidate) {
      if (!TERMINAL_STATES.has(job.state)) {
        return {
          ok: false,
          code: 'force_requires_terminal',
          message: '--force may only recheck terminal jobs (succeeded, validation_failed, failed)'
        }
      }
    } else if (!NON_FORCE_RECONCILE_STATES.has(job.state)) {
      return { ok: false, code: 'not_reconcilable', message: `Job state is ${job.state}` }
    }

    let auditHistory = job.auditHistory
    if (forceRevalidate && TERMINAL_STATES.has(job.state)) {
      auditHistory = appendAudit(job, {
        event: 'force_revalidate_started',
        prior_state: job.state,
        prior_envelope: job.resultEnvelope || null
      })
      updateJob(jobId, { state: 'validating', auditHistory, error: null, computerTaskSubmitted: true })
    }

    const upstream = __testOnlyFetchJobBoundArtifact
      ? await __testOnlyFetchJobBoundArtifact(jobId)
      : await (await import('./computerMcpLive.mjs')).fetchJobBoundArtifact(jobId)
    return await applyArtifactValidation(jobId, upstream, auditHistory)
  } finally {
    store.release()
  }
}

function findReconcilableJobs({ operation, arguments: args }) {
  const fs = require('fs')
  const path = require('path')
  const { jobsDir } = require('./jobStore.cjs')
  const dir = jobsDir()
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    return []
  }
  const matches = []
  for (const file of files) {
    const job = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    if (job.operation !== operation) continue
    if (JSON.stringify(job.arguments) !== JSON.stringify(args)) continue
    if (NON_FORCE_RECONCILE_STATES.has(job.state)) {
      matches.push(job)
    }
  }
  return matches
}

module.exports = {
  reconcileGatewayJob,
  findReconcilableJobs,
  TERMINAL_STATES,
  applyArtifactValidation,
  __testOnlySetPauseAfterReconcileJobRead,
  __testOnlySetFetchJobBoundArtifact
}
