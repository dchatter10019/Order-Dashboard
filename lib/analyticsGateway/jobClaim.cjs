const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { jobsDir, readJob, writeJobAtomic } = require('./jobStore.cjs')
const {
  jobProcessingMutexSegment,
  mutexPathForSegment,
  withExclusiveAdvisoryLock
} = require('./osAdvisoryLock.cjs')

const DEFAULT_STALE_LEASE_MS = 15 * 60 * 1000

function staleLeaseMs() {
  const n = Number(process.env.BEVVI_ANALYTICS_GATEWAY_STALE_LEASE_MS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_LEASE_MS
}

function processingLeasePath(jobId) {
  return path.join(jobsDir(), `.processing-${jobId}.lock`)
}

function processingJobMutexPath(jobId) {
  return mutexPathForSegment(jobProcessingMutexSegment(jobId))
}

function jobMutationLockPath(jobId) {
  return path.join(jobsDir(), `.jobmut-${jobId}.lock`)
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    if (err && err.code === 'ESRCH') return false
    return true
  }
}

function isPidConfirmedDead(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return false
  } catch (err) {
    return err && err.code === 'ESRCH'
  }
}

function writeProcessingLease(payload) {
  const file = processingLeasePath(payload.jobId)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

/** @deprecated Legacy gate reclaim removed; OS mutex does not use existence-based gates. */
function reclaimAbandonedProcessingGates() {
  return []
}

function withJobProcessingMutex(jobId, fn) {
  const segment = jobProcessingMutexSegment(jobId)
  const locked = withExclusiveAdvisoryLock(segment, fn)
  if (!locked.ok && locked.code === 'mutex_busy') {
    return { ok: false, code: 'lease_gate_busy', message: 'Processing job mutex busy' }
  }
  if (!locked.ok) return locked
  return locked
}

function withProcessingLeaseGate(jobId, fn) {
  return withJobProcessingMutex(jobId, fn)
}

function tryReclaimAbandonedProcessingLeaseInner(jobId) {
  const file = processingLeasePath(jobId)
  if (!fs.existsSync(file)) return { reclaimed: false }
  const existing = readJsonFile(file)
  if (!existing) return { reclaimed: false }

  const job = readJob(jobId)
  if (job?.computerTaskSubmitted) {
    return { reclaimed: false, code: 'remote_task_may_exist' }
  }
  if (isPidAlive(existing.pid)) {
    return { reclaimed: false, code: 'owner_alive_or_indeterminate' }
  }
  if (!isPidConfirmedDead(existing.pid)) {
    return { reclaimed: false, code: 'owner_indeterminate' }
  }
  const acquiredMs = Date.parse(existing.acquiredAt || '')
  if (!Number.isFinite(acquiredMs) || Date.now() - acquiredMs < staleLeaseMs()) {
    return { reclaimed: false, code: 'lease_not_stale_enough' }
  }
  if (job?.state !== 'queued' || job.submissionAttemptId) {
    return { reclaimed: false, code: 'job_not_reclaimable' }
  }
  try {
    fs.unlinkSync(file)
  } catch {
    return { reclaimed: false, code: 'unlink_failed' }
  }
  return { reclaimed: true }
}

function tryReclaimAbandonedProcessingLease(jobId) {
  const gated = withJobProcessingMutex(jobId, () => tryReclaimAbandonedProcessingLeaseInner(jobId))
  if (!gated.ok) return { reclaimed: false, code: gated.code || 'lease_gate_busy' }
  return gated.value
}

function reclaimAbandonedProcessingLeases() {
  ensureJobsDir()
  const reclaimed = []
  for (const file of fs.readdirSync(jobsDir())) {
    if (!file.startsWith('.processing-') || !file.endsWith('.lock')) continue
    if (file.includes('-gate-')) continue
    const jobId = file.slice('.processing-'.length, -'.lock'.length)
    const result = tryReclaimAbandonedProcessingLease(jobId)
    if (result.reclaimed) reclaimed.push(jobId)
  }
  return reclaimed
}

function ensureJobsDir() {
  fs.mkdirSync(jobsDir(), { recursive: true, mode: 0o700 })
}

function acquireProcessingLeaseInner(jobId, ownerId) {
  const payload = {
    jobId,
    ownerId,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    purpose: 'submission'
  }
  try {
    const fd = fs.openSync(processingLeasePath(jobId), 'wx', 0o600)
    fs.writeFileSync(fd, `${JSON.stringify(payload)}\n`)
    fs.closeSync(fd)
    return { ok: true, ownerId }
  } catch (err) {
    if (err.code !== 'EEXIST') throw err
    const existing = readJsonFile(processingLeasePath(jobId))
    if (existing?.ownerId === ownerId) return { ok: true, ownerId, reused: true }
    return {
      ok: false,
      code: 'duplicate_worker',
      message: 'Another worker holds the processing lease for this job',
      holder: existing?.ownerId || null
    }
  }
}

function acquireProcessingLease(jobId, ownerId) {
  ensureJobsDir()
  const gated = withJobProcessingMutex(jobId, () => acquireProcessingLeaseInner(jobId, ownerId))
  if (!gated.ok) return gated
  return gated.value
}

function acquireArtifactDeliveryLeaseInner(jobId, ownerId) {
  const file = processingLeasePath(jobId)
  const payload = {
    jobId,
    ownerId,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    purpose: 'artifact_delivery'
  }

  if (!fs.existsSync(file)) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600)
      fs.writeFileSync(fd, `${JSON.stringify(payload)}\n`)
      fs.closeSync(fd)
      return { ok: true, ownerId }
    } catch (err) {
      if (err.code !== 'EEXIST') throw err
    }
  }

  const existing = readJsonFile(file)
  if (!existing) {
    return acquireProcessingLeaseInner(jobId, ownerId)
  }
  if (existing.ownerId === ownerId) {
    return { ok: true, ownerId, reused: true }
  }
  if (isPidAlive(existing.pid)) {
    return {
      ok: false,
      code: 'duplicate_worker',
      message: 'Another worker holds the processing lease for this job',
      holder: existing.ownerId || null
    }
  }
  if (!isPidConfirmedDead(existing.pid)) {
    return {
      ok: false,
      code: 'owner_indeterminate',
      message: 'Cannot confirm prior lease holder is dead; artifact delivery blocked'
    }
  }

  const acquiredMs = Date.parse(existing.acquiredAt || '')
  const ageMs = Number.isFinite(acquiredMs) ? Date.now() - acquiredMs : staleLeaseMs()
  if (existing.purpose === 'artifact_delivery' && ageMs < staleLeaseMs()) {
    return {
      ok: false,
      code: 'artifact_delivery_in_progress',
      message: 'Recent artifact-delivery lease must expire before another takeover',
      holder: existing.ownerId || null
    }
  }

  writeProcessingLease(payload)
  return { ok: true, ownerId, takenOver: true }
}

function acquireArtifactDeliveryLease(jobId, ownerId) {
  ensureJobsDir()
  const gated = withJobProcessingMutex(jobId, () => acquireArtifactDeliveryLeaseInner(jobId, ownerId))
  if (!gated.ok) return gated
  return gated.value
}

function releaseProcessingLease(jobId, ownerId) {
  const gated = withJobProcessingMutex(jobId, () => {
    const existing = readJsonFile(processingLeasePath(jobId))
    if (existing?.ownerId === ownerId) {
      try {
        fs.unlinkSync(processingLeasePath(jobId))
      } catch {
        /* ignore */
      }
    }
    return { ok: true }
  })
  if (!gated.ok) return gated
  return gated.value
}

function withJobMutationLock(jobId, fn) {
  ensureJobsDir()
  const lockFile = jobMutationLockPath(jobId)
  const token = crypto.randomUUID()
  try {
    const fd = fs.openSync(lockFile, 'wx', 0o600)
    fs.writeFileSync(fd, `${token}\n`)
    fs.closeSync(fd)
  } catch (err) {
    if (err.code === 'EEXIST') {
      return { ok: false, code: 'job_lock_busy', message: 'Job mutation lock busy' }
    }
    throw err
  }
  try {
    return { ok: true, value: fn() }
  } finally {
    let current = null
    try {
      current = fs.readFileSync(lockFile, 'utf8').trim()
    } catch {
      current = null
    }
    if (current === token) {
      try {
        fs.unlinkSync(lockFile)
      } catch {
        /* ignore */
      }
    }
  }
}

function transitionJobState(jobId, fromStates, patch) {
  const locked = withJobMutationLock(jobId, () => {
    const job = readJob(jobId)
    if (!job) return null
    if (!fromStates.includes(job.state)) return null
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() }
    writeJobAtomic(next)
    return next
  })
  if (!locked.ok) return null
  return locked.value
}

function newProcessingOwnerId() {
  return `${process.pid}-${crypto.randomUUID()}`
}

module.exports = {
  acquireProcessingLease,
  acquireArtifactDeliveryLease,
  releaseProcessingLease,
  transitionJobState,
  newProcessingOwnerId,
  withJobMutationLock,
  withProcessingLeaseGate,
  withJobProcessingMutex,
  processingJobMutexPath,
  reclaimAbandonedProcessingGates,
  tryReclaimAbandonedProcessingLease,
  reclaimAbandonedProcessingLeases,
  isPidAlive,
  isPidConfirmedDead
}
