const LIVE_EXECUTION_MODES = new Set(['smoke', 'production', 'local_test'])
const VALID_EXECUTION_MODES = new Set(['mock', 'smoke', 'production', 'local_test'])

function getPersistedJobExecutionMode(job) {
  const mode = job?.gatewayExecutionMode
  if (typeof mode !== 'string') return null
  const normalized = mode.toLowerCase()
  return VALID_EXECUTION_MODES.has(normalized) ? normalized : null
}

function isLiveExecutionMode(mode) {
  return LIVE_EXECUTION_MODES.has(mode)
}

function requiresPersistedExecutionContext(job) {
  if (!job) return false
  if (job.submissionAttemptId || job.computerTaskSubmitted) return true
  return [
    'running',
    'awaiting_artifact',
    'validating',
    'submission_uncertain',
    'delivery_failed'
  ].includes(job.state)
}

/**
 * Fail closed before recovery/provider/mock fixture paths mutate a job.
 * Does not infer mode from result envelopes.
 */
function assertProcessModeCompatibleWithJob(job, processMode) {
  const process = String(processMode || '').toLowerCase()
  if (!VALID_EXECUTION_MODES.has(process)) {
    return { ok: false, code: 'invalid_process_mode', message: 'Invalid gateway process mode' }
  }

  const persisted = getPersistedJobExecutionMode(job)
  if (!persisted) {
    return {
      ok: false,
      code: 'execution_context_missing',
      message: 'Persisted gatewayExecutionMode is missing or ambiguous'
    }
  }

  if (process === 'mock' && persisted !== 'mock') {
    return {
      ok: false,
      code: 'execution_mode_mismatch',
      message: 'Mock gateway process cannot recover or finalize a live-submitted job'
    }
  }
  if (process !== 'mock' && persisted === 'mock') {
    return {
      ok: false,
      code: 'execution_mode_mismatch',
      message: 'Live gateway process cannot drive a mock-only job'
    }
  }
  if (isLiveExecutionMode(persisted) && isLiveExecutionMode(process) && persisted !== process) {
    return {
      ok: false,
      code: 'execution_mode_mismatch',
      message: `Job requires gateway process mode ${persisted}`
    }
  }

  return { ok: true, executionMode: persisted }
}

function gatewayModeForJobFinalization(job, upstream = null) {
  const persisted = getPersistedJobExecutionMode(job)
  if (!persisted) return null
  if (upstream?.mode === 'mock' && persisted !== 'mock') {
    return null
  }
  return persisted
}

function assertUpstreamCompatibleWithJob(job, upstream) {
  if (!upstream?.ok) return { ok: true }
  const persisted = getPersistedJobExecutionMode(job)
  if (!persisted) {
    return {
      ok: false,
      code: 'execution_context_missing',
      message: 'Cannot apply upstream result without persisted gatewayExecutionMode'
    }
  }
  if (upstream.mode === 'mock' && persisted !== 'mock') {
    return {
      ok: false,
      code: 'execution_mode_mismatch',
      message: 'Mock upstream result cannot finalize a live-submitted job'
    }
  }
  return { ok: true, executionMode: persisted }
}

module.exports = {
  LIVE_EXECUTION_MODES,
  VALID_EXECUTION_MODES,
  getPersistedJobExecutionMode,
  requiresPersistedExecutionContext,
  assertProcessModeCompatibleWithJob,
  gatewayModeForJobFinalization,
  assertUpstreamCompatibleWithJob
}
