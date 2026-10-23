const { releaseThreadAdmission, updateThreadAdmission } = require('./jobAdmission.cjs')
const { listQueuedJobsForDispatch } = require('./jobStore.cjs')
const { publishQueuedJobDispatchSignal, runQueuedJobDispatchTick } = require('./queuedJobDispatch.cjs')

let processJobRef = null

function registerQueueDispatchHandler(fn) {
  processJobRef = fn
}

function dispatchQueuedJobsAfterAdmissionRelease() {
  publishQueuedJobDispatchSignal('admission_released')
  if (processJobRef) {
    for (const job of listQueuedJobsForDispatch()) {
      processJobRef(job.jobId).catch(() => {})
    }
    return
  }
  runQueuedJobDispatchTick()
}

function completeThreadAdmissionForJob(jobId, state, ownerId = null) {
  updateThreadAdmission(jobId, state, ownerId)
  if (['succeeded', 'failed', 'validation_failed'].includes(state)) {
    releaseThreadAdmission(jobId, ownerId)
    dispatchQueuedJobsAfterAdmissionRelease()
  }
}

module.exports = {
  registerQueueDispatchHandler,
  dispatchQueuedJobsAfterAdmissionRelease,
  completeThreadAdmissionForJob
}
