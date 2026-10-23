const fs = require('fs')
const path = require('path')
const { jobsDir, readJob } = require('./jobStore.cjs')
const { COMPUTER_THREAD_ID } = require('./constants.cjs')

const LOCK_FILE = 'thread-admission.lock'

function lockPath() {
  return path.join(jobsDir(), LOCK_FILE)
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockPath(), 'utf8'))
  } catch {
    return null
  }
}

function isUnresolvedState(state) {
  return [
    'queued',
    'running',
    'awaiting_artifact',
    'validating',
    'submission_uncertain',
    'needs_input',
    'needs_auth',
    'delivery_failed'
  ].includes(state)
}

function jobBlocksThread(job) {
  if (!job) return false
  if (isUnresolvedState(job.state)) return true
  if (job.computerTaskSubmitted && !['succeeded', 'failed', 'validation_failed'].includes(job.state)) {
    return true
  }
  return false
}

function acquireThreadAdmission(jobId, ownerId) {
  fs.mkdirSync(jobsDir(), { recursive: true, mode: 0o700 })
  const payload = {
    threadId: COMPUTER_THREAD_ID,
    jobId,
    ownerId,
    state: 'queued',
    ownerPid: process.pid,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
  try {
    const fd = fs.openSync(lockPath(), 'wx', 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(payload)}\n`)
    fs.closeSync(fd)
    return { ok: true, ownerId }
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
    const existing = readLock()
    if (existing?.jobId === jobId && existing?.ownerId === ownerId) {
      return { ok: true, ownerId, reused: true }
    }
    const blockingJob = existing?.jobId ? readJob(existing.jobId) : null
    if (blockingJob && jobBlocksThread(blockingJob)) {
      return {
        ok: false,
        code: 'thread_busy',
        message: 'Earlier submission on fixed thread is still unresolved',
        blockingJobId: existing.jobId
      }
    }
    if (existing?.jobId && blockingJob && !jobBlocksThread(blockingJob)) {
      releaseThreadAdmission(existing.jobId, existing.ownerId)
      return acquireThreadAdmission(jobId, ownerId)
    }
    return {
      ok: false,
      code: 'thread_busy',
      message: 'Thread admission lock held',
      blockingJobId: existing?.jobId || null
    }
  }
}

function updateThreadAdmission(jobId, state, ownerId) {
  const existing = readLock()
  if (!existing || existing.jobId !== jobId) return
  if (ownerId && existing.ownerId && existing.ownerId !== ownerId) return
  const next = { ...existing, state, updatedAt: new Date().toISOString() }
  fs.writeFileSync(lockPath(), `${JSON.stringify(next)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function releaseThreadAdmission(jobId, ownerId) {
  const existing = readLock()
  if (existing?.jobId === jobId && (!ownerId || existing.ownerId === ownerId)) {
    try {
      fs.unlinkSync(lockPath())
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  acquireThreadAdmission,
  updateThreadAdmission,
  releaseThreadAdmission,
  isUnresolvedState,
  jobBlocksThread,
  readLock
}
