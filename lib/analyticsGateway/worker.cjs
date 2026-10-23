const crypto = require('crypto')
const { createJob, readJob, updateJob, countJobsForClient } = require('./jobStore.cjs')
const { validateOperationInput } = require('./operations.cjs')
const { executeAnalyticsOnComputer } = require('./computerMcpClient.cjs')
const { finalizeValidatedJob } = require('./jobValidation.cjs')
const { COMPUTER_THREAD_ID } = require('./constants.cjs')
const {
  getRuntimeMode,
  validateModeConfiguration,
  isOperationAllowedInMode
} = require('./modes.cjs')
const { authorizeJobSubmission, authorizeJobRetrieval } = require('./authorizationPolicy.cjs')
const { getGatewayLimits } = require('./gatewayLimits.cjs')
const {
  acquireThreadAdmission,
  updateThreadAdmission,
  releaseThreadAdmission
} = require('./jobAdmission.cjs')
const {
  acquireProcessingLease,
  acquireArtifactDeliveryLease,
  releaseProcessingLease,
  transitionJobState,
  newProcessingOwnerId
} = require('./jobClaim.cjs')
const {
  registerQueueDispatchHandler,
  completeThreadAdmissionForJob,
  dispatchQueuedJobsAfterAdmissionRelease
} = require('./admissionDispatch.cjs')
const { redactStoredError } = require('./errorRedaction.cjs')
const {
  assertProcessModeCompatibleWithJob,
  assertUpstreamCompatibleWithJob,
  gatewayModeForJobFinalization
} = require('./jobExecutionContext.cjs')

let queueDepth = 0
let queueChain = Promise.resolve()

const ARTIFACT_RETRY_BASE_MS = 2000
const ARTIFACT_RETRY_MAX = 8

function enqueue(fn) {
  const limits = getGatewayLimits()
  if (queueDepth >= limits.maxQueueDepth) {
    return Promise.reject(Object.assign(new Error('Gateway queue full'), { code: 'queue_full' }))
  }
  queueDepth += 1
  queueChain = queueChain
    .then(async () => fn())
    .catch((err) => {
      console.error('[analytics-gateway] queue error:', err.message)
    })
    .finally(() => {
      queueDepth -= 1
    })
  return queueChain
}

function __testOnlyFlushQueue() {
  return queueChain
}

function applyUpstreamOutcome(jobId, upstream, admissionOwnerId = null) {
  if (!upstream.ok) {
    const stateMap = {
      needs_auth: 'needs_auth',
      needs_refresh: 'needs_auth',
      needs_input: 'needs_input',
      insufficient_credits: 'failed',
      submission_uncertain: 'submission_uncertain',
      awaiting_artifact: 'awaiting_artifact'
    }
    const { PROVIDER_DELIVERY_ERRORS } = require('./providerContract.cjs')
    const state = stateMap[upstream.code] ||
      (upstream.artifactDeliveryError || PROVIDER_DELIVERY_ERRORS.has(upstream.code) ? 'delivery_failed' : 'failed')
    const patch = {
      state,
      error: redactStoredError({ code: upstream.code, message: upstream.message })
    }
    if (upstream.computerTaskSubmitted) {
      patch.computerTaskSubmitted = true
    }
    if (state === 'awaiting_artifact') {
      const job = readJob(jobId)
      const retry = (job?.artifactRetryCount || 0) + 1
      patch.artifactRetryCount = retry
      if (retry <= ARTIFACT_RETRY_MAX) {
        const delay = Math.min(ARTIFACT_RETRY_BASE_MS * 2 ** (retry - 1), 120_000)
        patch.artifactNextRetryAt = new Date(Date.now() + delay).toISOString()
      } else {
        patch.state = 'delivery_failed'
        patch.error = redactStoredError({
          code: 'artifact_retries_exhausted',
          message: 'Artifact delivery retries exhausted; remote task may still be active'
        })
      }
    }
    updateJob(jobId, patch)
    if (['succeeded', 'failed', 'validation_failed'].includes(patch.state)) {
      completeThreadAdmissionForJob(jobId, patch.state, admissionOwnerId)
    } else {
      updateThreadAdmission(jobId, patch.state, admissionOwnerId)
    }
    return false
  }

  const jobForFinalize = readJob(jobId)
  const upstreamCompat = assertUpstreamCompatibleWithJob(jobForFinalize, upstream)
  if (!upstreamCompat.ok) {
    updateJob(jobId, {
      state: 'validation_failed',
      error: redactStoredError({ code: upstreamCompat.code, message: upstreamCompat.message }),
      computerTaskSubmitted: true
    })
    completeThreadAdmissionForJob(jobId, 'validation_failed', admissionOwnerId)
    return false
  }
  const finalGatewayMode = gatewayModeForJobFinalization(jobForFinalize, upstream)
  if (!finalGatewayMode) {
    updateJob(jobId, {
      state: 'validation_failed',
      error: redactStoredError({
        code: 'execution_context_missing',
        message: 'Missing persisted execution mode for finalization'
      }),
      computerTaskSubmitted: true
    })
    completeThreadAdmissionForJob(jobId, 'validation_failed', admissionOwnerId)
    return false
  }

  updateJob(jobId, { state: 'validating', computerTaskSubmitted: true })
  updateThreadAdmission(jobId, 'validating', admissionOwnerId)
  const finalized = finalizeValidatedJob({
    job: jobForFinalize,
    rawResult: upstream.result,
    assetIdentity: upstream.assetIdentity || null,
    gatewayMode: finalGatewayMode
  })
  if (!finalized.ok) {
    updateJob(jobId, {
      state: finalized.state,
      error: redactStoredError(finalized.error),
      computerTaskSubmitted: true
    })
    completeThreadAdmissionForJob(jobId, finalized.state, admissionOwnerId)
    return false
  }
  updateJob(jobId, {
    state: finalized.state,
    resultEnvelope: finalized.envelope,
    error: null,
    computerTaskSubmitted: true,
    artifactNextRetryAt: null,
    waitingForThreadAdmission: false
  })
  try {
    completeThreadAdmissionForJob(jobId, finalized.state, admissionOwnerId)
  } catch {
    /* post-validation wakeup is best-effort; terminal job state is already durable */
  }
  return true
}

async function deliverArtifactsForJob(jobId, options = {}) {
  const { allowUncertain = false, admissionOwnerId = null } = options
  const job = readJob(jobId)
  if (!job) return

  const allowedStates = allowUncertain
    ? ['submission_uncertain', 'awaiting_artifact', 'validating', 'delivery_failed']
    : ['awaiting_artifact', 'validating', 'delivery_failed']

  if (!allowedStates.includes(job.state)) return
  if (!job.computerTaskSubmitted) return
  if (job.artifactNextRetryAt && Date.parse(job.artifactNextRetryAt) > Date.now()) {
    return
  }

  const mode = getRuntimeMode()
  const compat = assertProcessModeCompatibleWithJob(job, mode)
  if (!compat.ok) {
    console.error(
      `[analytics-gateway] blocked delivery for ${jobId}: ${compat.code} — ${compat.message}`
    )
    return
  }

  const ownerForAdmission = admissionOwnerId || job.processingOwnerId || null

  try {
    if (mode === 'mock') {
      const upstream = await executeAnalyticsOnComputer({
        operation: job.operation,
        arguments: job.arguments,
        jobId,
        artifactOnly: true
      })
      applyUpstreamOutcome(jobId, upstream, ownerForAdmission)
      return
    }

    const { fetchJobBoundArtifact } = await import('./computerMcpLive.mjs')
    const fetched = await fetchJobBoundArtifact(jobId)
    if (!fetched.ok) {
      applyUpstreamOutcome(
        jobId,
        {
          ok: false,
          code: fetched.code === 'missing_result' ? 'awaiting_artifact' : fetched.code,
          message: fetched.message,
          computerTaskSubmitted: true
        },
        ownerForAdmission
      )
      return
    }
    applyUpstreamOutcome(
      jobId,
      {
        ok: true,
        mode: 'live',
        result: fetched.payload,
        assetIdentity: fetched.assetIdentity,
        computerTaskSubmitted: true
      },
      ownerForAdmission
    )
  } catch (err) {
    updateJob(jobId, {
      state: 'delivery_failed',
      error: redactStoredError({ code: 'delivery_failed', message: err.message })
    })
    updateThreadAdmission(jobId, 'delivery_failed', ownerForAdmission)
  }
}

function processJob(jobId, options = {}) {
  const forcedOwnerId = options.ownerId || null
  return enqueue(async () => {
    const ownerId = forcedOwnerId || newProcessingOwnerId()
    const lease = acquireProcessingLease(jobId, ownerId)
    if (!lease.ok) return

    try {
      let job = readJob(jobId)
      if (!job || job.state !== 'queued') return

      const execCompat = assertProcessModeCompatibleWithJob(job, getRuntimeMode())
      if (!execCompat.ok) {
        console.error(
          `[analytics-gateway] blocked processing for ${jobId}: ${execCompat.code} — ${execCompat.message}`
        )
        return
      }

      const claimed = transitionJobState(jobId, ['queued'], {
        state: 'running',
        processingOwnerId: ownerId,
        computerThreadId: COMPUTER_THREAD_ID,
        submissionAttemptId: crypto.randomUUID(),
        submissionRecordedAt: new Date().toISOString(),
        waitingForThreadAdmission: false
      })
      if (!claimed) return

      const admission = acquireThreadAdmission(jobId, ownerId)
      if (!admission.ok) {
        transitionJobState(jobId, ['running'], {
          state: 'queued',
          processingOwnerId: null,
          submissionAttemptId: null,
          submissionRecordedAt: null,
          waitingForThreadAdmission: true
        })
        return
      }

      updateThreadAdmission(jobId, 'running', ownerId)
      job = readJob(jobId)
      if (!job || job.processingOwnerId !== ownerId) return

      try {
        const upstream = await executeAnalyticsOnComputer({
          operation: job.operation,
          arguments: job.pythonArguments || job.arguments,
          jobId
        })
        if (upstream.computerTaskSubmitted) {
          updateJob(jobId, {
            computerTaskSubmitted: true,
            submissionAcknowledgedAt: new Date().toISOString()
          })
        }
        applyUpstreamOutcome(jobId, upstream, ownerId)
      } catch (err) {
        const latest = readJob(jobId)
        if (
          latest &&
          ['succeeded', 'validation_failed'].includes(latest.state) &&
          latest.resultEnvelope
        ) {
          return
        }
        if (err && err.code === 'signal_write_busy') {
          return
        }
        const uncertain = Boolean(latest?.submissionAttemptId)
        updateJob(jobId, {
          state: uncertain ? 'submission_uncertain' : 'failed',
          error: redactStoredError({
            code: uncertain ? 'submission_uncertain' : 'failed',
            message: err.message
          }),
          computerTaskSubmitted: uncertain ? true : latest?.computerTaskSubmitted
        })
        updateThreadAdmission(jobId, uncertain ? 'submission_uncertain' : 'failed', ownerId)
      }
    } finally {
      releaseProcessingLease(jobId, ownerId)
    }
  })
}

function resumeArtifactDelivery(jobId, options = {}) {
  const ownerId = options.ownerId || newProcessingOwnerId()
  return enqueue(async () => {
    const lease = acquireArtifactDeliveryLease(jobId, ownerId)
    if (!lease.ok) return
    try {
      await deliverArtifactsForJob(jobId, {
        allowUncertain: false,
        admissionOwnerId: readJob(jobId)?.processingOwnerId || ownerId
      })
    } finally {
      releaseProcessingLease(jobId, ownerId)
    }
  })
}

function reconcileSubmissionUncertain(jobId) {
  return enqueue(async () => {
    const job = readJob(jobId)
    if (!job || job.state !== 'submission_uncertain') return
    if (!job.computerTaskSubmitted) return
    const ownerId = newProcessingOwnerId()
    const lease = acquireArtifactDeliveryLease(jobId, ownerId)
    if (!lease.ok) return
    try {
      await deliverArtifactsForJob(jobId, {
        allowUncertain: true,
        admissionOwnerId: job.processingOwnerId || ownerId
      })
    } finally {
      releaseProcessingLease(jobId, ownerId)
    }
  })
}

function requestAnalytics(clientMeta, { operation, arguments: args, idempotencyKey }) {
  const modeCheck = validateModeConfiguration(getRuntimeMode())
  if (!modeCheck.ok) {
    return { ok: false, error: modeCheck.message, code: modeCheck.code }
  }
  if (process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED === 'false') {
    return { ok: false, error: 'Analytics gateway disabled', code: 'disabled' }
  }
  if (!isOperationAllowedInMode(operation, getRuntimeMode())) {
    return {
      ok: false,
      error: `Operation not allowed in ${getRuntimeMode()} mode`,
      code: 'forbidden'
    }
  }
  const authz = authorizeJobSubmission(clientMeta, operation, args)
  if (!authz.ok) {
    return { ok: false, error: authz.message, code: authz.code }
  }
  const validation = validateOperationInput(operation, args)
  if (!validation.ok) {
    return { ok: false, error: validation.error, code: validation.code || 'invalid_arguments' }
  }

  let localTestManifestMark = null
  if (getRuntimeMode() === 'local_test') {
    const { validateLocalTestSubmission } = require('./localTestManifest.cjs')
    const manifestCheck = validateLocalTestSubmission({
      clientId: clientMeta.clientId,
      operation,
      normalizedArgs: validation.normalized,
      idempotencyKey
    })
    if (!manifestCheck.ok) {
      return { ok: false, error: manifestCheck.message, code: manifestCheck.code }
    }
    localTestManifestMark = {
      operation,
      normalizedArgs: validation.normalized,
      idempotencyKey
    }
  }

  const limits = getGatewayLimits()
  if (countJobsForClient(clientMeta.clientId) >= limits.maxJobsPerClient) {
    return { ok: false, error: 'Client job admission limit reached', code: 'rate_limited' }
  }

  const { job, created, conflict } = createJob({
    clientId: clientMeta.clientId,
    operation,
    arguments: validation.normalized,
    pythonArguments: validation.pythonArguments,
    gatewayOutputSelection: validation.gatewayOutputSelection,
    idempotencyKey
  })
  if (conflict) {
    return {
      ok: false,
      error: 'Idempotency key reused with different request',
      code: 'idempotency_conflict',
      jobId: job.jobId
    }
  }
  if (localTestManifestMark && created) {
    const { markLocalTestSubmissionAttempted } = require('./localTestManifest.cjs')
    markLocalTestSubmissionAttempted({
      ...localTestManifestMark,
      jobId: job.jobId
    })
  }

  if (job.state === 'queued' && created) {
    processJob(job.jobId).catch(() => {})
  }
  return { ok: true, jobId: job.jobId, state: job.state, created }
}

function getAnalyticsJob(jobId, clientMeta) {
  const job = readJob(jobId)
  if (!job) return { ok: false, code: 'not_found' }
  const authz = authorizeJobRetrieval(clientMeta, job)
  if (!authz.ok) return authz
  return {
    ok: true,
    job: {
      jobId: job.jobId,
      state: job.state,
      operation: job.operation,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      error: job.error ? redactStoredError(job.error) : null
    }
  }
}

function getAnalyticsResult(jobId, clientMeta) {
  const job = readJob(jobId)
  if (!job) return { ok: false, code: 'not_found' }
  const authz = authorizeJobRetrieval(clientMeta, job)
  if (!authz.ok) return authz
  if (job.state !== 'succeeded') {
    return {
      ok: false,
      code: 'not_ready',
      state: job.state,
      error: job.error ? redactStoredError(job.error) : null
    }
  }
  return { ok: true, envelope: job.resultEnvelope }
}

registerQueueDispatchHandler((jobId) => processJob(jobId))

module.exports = {
  requestAnalytics,
  getAnalyticsJob,
  getAnalyticsResult,
  processJob,
  resumeArtifactDelivery,
  reconcileSubmissionUncertain,
  deliverArtifactsForJob,
  dispatchQueuedJobsAfterAdmissionRelease,
  applyUpstreamOutcome,
  __testOnlyFlushQueue,
  get queueDepth() {
    return queueDepth
  }
}
