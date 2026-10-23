const fs = require('fs')
const path = require('path')
const { jobsDir, readJob, updateJob } = require('./jobStore.cjs')
const { reclaimAbandonedProcessingLeases } = require('./jobClaim.cjs')
const { redactStoredError } = require('./errorRedaction.cjs')
const { getRuntimeMode } = require('./modes.cjs')
const { assertProcessModeCompatibleWithJob } = require('./jobExecutionContext.cjs')

const RECOVERABLE_STATES = new Set([
  'queued',
  'running',
  'awaiting_artifact',
  'validating',
  'submission_uncertain',
  'delivery_failed'
])

function markRunningCrashUncertain(jobId) {
  const job = readJob(jobId)
  if (!job || job.state !== 'running') return false
  const compat = assertProcessModeCompatibleWithJob(job, getRuntimeMode())
  if (!compat.ok) return false
  updateJob(jobId, {
    state: 'submission_uncertain',
    computerTaskSubmitted: job.computerTaskSubmitted || Boolean(job.submissionAttemptId),
    error: redactStoredError({
      code: 'submission_uncertain',
      message: 'Interrupted during submission; reconcile read-only before retry'
    })
  })
  return true
}

function listRecoverableJobs() {
  const dir = jobsDir()
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.'))
  } catch {
    return []
  }
  const jobs = []
  for (const file of files) {
    let job
    try {
      job = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))
    } catch {
      continue
    }
    if (!RECOVERABLE_STATES.has(job.state)) continue

    if (job.state === 'queued' && !job.submissionAttemptId) {
      jobs.push({ jobId: job.jobId, mode: 'process' })
      continue
    }

    if (job.state === 'running') {
      jobs.push({ jobId: job.jobId, mode: 'uncertain' })
      continue
    }

    if (job.state === 'submission_uncertain') {
      jobs.push({ jobId: job.jobId, mode: 'reconcile' })
      continue
    }

    if (['awaiting_artifact', 'validating', 'delivery_failed'].includes(job.state) && job.computerTaskSubmitted) {
      jobs.push({ jobId: job.jobId, mode: 'resume' })
    }
  }
  return jobs
}

function recoverInterruptedJobs(resumeFn, processFn, reconcileFn, dispatchQueuedFn) {
  reclaimAbandonedProcessingLeases()
  const entries = listRecoverableJobs()
  const processMode = getRuntimeMode()
  for (const entry of entries) {
    const job = readJob(entry.jobId)
    if (!job) continue
    const compat = assertProcessModeCompatibleWithJob(job, processMode)
    if (!compat.ok) continue
    if (entry.mode === 'process') processFn(entry.jobId)
    else if (entry.mode === 'resume') resumeFn(entry.jobId)
    else if (entry.mode === 'reconcile') reconcileFn(entry.jobId)
    else if (entry.mode === 'uncertain') {
      if (!markRunningCrashUncertain(entry.jobId)) continue
      reconcileFn(entry.jobId)
    }
  }
  if (dispatchQueuedFn) dispatchQueuedFn()
  return entries.length
}

module.exports = {
  RECOVERABLE_STATES,
  listRecoverableJobs,
  recoverInterruptedJobs,
  markRunningCrashUncertain
}
