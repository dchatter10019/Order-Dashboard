const { COMPUTER_THREAD_ID } = require('./constants.cjs')
const {
  getRuntimeMode,
  validateModeConfiguration,
  isLiveComputerMode,
  isOperationAllowedInMode
} = require('./modes.cjs')
const { readJob } = require('./jobStore.cjs')
const { buildMockHandlerResult, applyPlanningHorizonSelection } = require('./mockHandlerResult.cjs')
const { wrapHandlerArtifact } = require('./jobBinding.cjs')

let __testOnlyArtifactOnlyQueue = null

function __testOnlySetArtifactOnlyQueue(entries) {
  __testOnlyArtifactOnlyQueue = Array.isArray(entries) ? [...entries] : null
}

async function runMockAnalyticsJob({ operation, arguments: args, jobId, artifactOnly = false }) {
  if (artifactOnly && __testOnlyArtifactOnlyQueue?.length) {
    const next = __testOnlyArtifactOnlyQueue.shift()
    return typeof next === 'function' ? next({ operation, arguments: args, jobId, artifactOnly }) : next
  }
  const job = readJob(jobId) || {
    jobId,
    operation,
    arguments: args,
    requestHash: 'mock'
  }
  let handlerResult = buildMockHandlerResult({
    operation,
    args: job.arguments || args,
    jobId: job.jobId || jobId
  })
  if (
    job.operation === 'bevvi_planning_forecast' &&
    job.gatewayOutputSelection?.horizon_days
  ) {
    handlerResult = applyPlanningHorizonSelection(
      handlerResult,
      job.gatewayOutputSelection.horizon_days
    )
  }
  const wrapped = wrapHandlerArtifact(job, handlerResult)
  return {
    ok: true,
    mode: 'mock',
    threadId: COMPUTER_THREAD_ID,
    result: wrapped
  }
}

async function runLiveAnalyticsJob({ operation, arguments: args, jobId, artifactOnly = false }) {
  const mode = getRuntimeMode()
  const cfg = validateModeConfiguration(mode)
  if (!cfg.ok) {
    return { ok: false, code: cfg.code, message: cfg.message }
  }
  if (!isOperationAllowedInMode(operation, mode)) {
    return {
      ok: false,
      code: 'forbidden',
      message: `Operation ${operation} is not permitted in ${mode} mode`
    }
  }

  const jobRecord = readJob(jobId)
  if (!jobRecord) {
    return { ok: false, code: 'not_found', message: 'Gateway job not found for live execution' }
  }

  const { runLiveComputerAnalyticsJob } = await import('./computerMcpLive.mjs')
  return runLiveComputerAnalyticsJob({
    operation,
    arguments: args,
    jobId,
    jobRecord,
    reconcileOnly: artifactOnly
  })
}

let __testOnlySubmitSpy = null

function __testOnlySetSubmitSpy(fn) {
  __testOnlySubmitSpy = fn
}

async function executeAnalyticsOnComputer(params) {
  if (__testOnlySubmitSpy) __testOnlySubmitSpy(params)
  const mode = getRuntimeMode()
  if (mode === 'mock') {
    return runMockAnalyticsJob(params)
  }
  if (isLiveComputerMode(mode)) {
    return runLiveAnalyticsJob(params)
  }
  return { ok: false, code: 'invalid_mode', message: 'Unknown analytics gateway mode' }
}

module.exports = {
  executeAnalyticsOnComputer,
  runMockAnalyticsJob,
  runLiveAnalyticsJob,
  __testOnlySetSubmitSpy,
  __testOnlySetArtifactOnlyQueue
}
