const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { hashCanonicalArguments } = require('./canonicalJson.cjs')
const { getRuntimeMode } = require('./modes.cjs')

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'data', 'analytics-gateway', 'jobs')
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jobsDir() {
  return path.resolve(process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR || DEFAULT_DIR)
}

function assertJobId(jobId) {
  const id = String(jobId || '')
  if (!UUID_RE.test(id)) {
    throw new Error('Invalid job id')
  }
  return id
}

function jobPath(jobId) {
  const id = assertJobId(jobId)
  const base = jobsDir()
  const file = path.resolve(base, `${id}.json`)
  if (!file.startsWith(`${base}${path.sep}`) && file !== path.join(base, `${id}.json`)) {
    throw new Error('Path traversal rejected')
  }
  if (file.includes(`${path.sep}..${path.sep}`)) {
    throw new Error('Path traversal rejected')
  }
  return file
}

function ensureDir() {
  const dir = jobsDir()
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

function safeReadJobFile(file) {
  const stat = fs.lstatSync(file)
  if (!stat.isFile()) throw new Error('Job path is not a regular file')
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function readJob(jobId) {
  try {
    return safeReadJobFile(jobPath(jobId))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    if (err.message === 'Invalid job id') return null
    throw err
  }
}

function writeJobAtomic(job) {
  ensureDir()
  const file = jobPath(job.jobId)
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(job, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
}

function idempotencyLockPath(clientId, idempotencyKey) {
  const digest = crypto
    .createHash('sha256')
    .update(`${clientId}\0${idempotencyKey}`)
    .digest('hex')
  return path.join(jobsDir(), `.idempotency-${digest}.lock`)
}

function createJob({
  clientId,
  operation,
  arguments: args,
  idempotencyKey = null,
  pythonArguments = null,
  gatewayOutputSelection = null
}) {
  const requestHash = hashCanonicalArguments(args)

  if (idempotencyKey) {
    const existing = findByIdempotency(clientId, idempotencyKey)
    if (existing) {
      if (existing.operation !== operation || existing.requestHash !== requestHash) {
        return { job: existing, created: false, conflict: true }
      }
      return { job: existing, created: false, conflict: false }
    }
    ensureDir()
    const lockFile = idempotencyLockPath(clientId, idempotencyKey)
    try {
      const fd = fs.openSync(lockFile, 'wx', 0o600)
      fs.writeFileSync(fd, `${requestHash}\n`)
      fs.closeSync(fd)
    } catch (err) {
      if (err.code === 'EEXIST') {
        const raced = findByIdempotency(clientId, idempotencyKey)
        if (raced) {
          if (raced.operation !== operation || raced.requestHash !== requestHash) {
            return { job: raced, created: false, conflict: true }
          }
          return { job: raced, created: false, conflict: false }
        }
      }
      throw err
    }
  }

  const jobId = crypto.randomUUID()
  const now = new Date().toISOString()
  const job = {
    jobId,
    clientId,
    operation,
    arguments: args,
    pythonArguments: pythonArguments || args,
    gatewayOutputSelection,
    idempotencyKey,
    requestHash,
    state: 'queued',
    createdAt: now,
    updatedAt: now,
    computerThreadId: null,
    submissionAttemptId: null,
    computerTaskSubmitted: false,
    artifactRetryCount: 0,
    artifactNextRetryAt: null,
    waitingForThreadAdmission: false,
    upstreamTaskRef: null,
    error: null,
    resultEnvelope: null,
    gatewayExecutionMode: getRuntimeMode()
  }
  writeJobAtomic(job)
  return { job, created: true, conflict: false }
}

function findByIdempotency(clientId, idempotencyKey) {
  ensureDir()
  const dir = jobsDir()
  let files = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('.'))
  } catch {
    return null
  }
  for (const file of files) {
    const full = path.join(dir, file)
    if (path.basename(full) !== file) continue
    const job = safeReadJobFile(full)
    if (job.clientId === clientId && job.idempotencyKey === idempotencyKey) return job
  }
  return null
}

function listJobs(filterFn = null) {
  ensureDir()
  const jobs = []
  for (const file of fs.readdirSync(jobsDir())) {
    if (!file.endsWith('.json') || file.startsWith('.')) continue
    const job = safeReadJobFile(path.join(jobsDir(), file))
    if (!filterFn || filterFn(job)) jobs.push(job)
  }
  return jobs
}

function listQueuedJobsForDispatch() {
  return listJobs(
    (job) =>
      job.state === 'queued' &&
      !job.submissionAttemptId &&
      (job.waitingForThreadAdmission === true || job.waitingForThreadAdmission == null)
  )
}

function countJobsForClient(clientId) {
  ensureDir()
  let count = 0
  for (const file of fs.readdirSync(jobsDir())) {
    if (!file.endsWith('.json') || file.startsWith('.')) continue
    const job = safeReadJobFile(path.join(jobsDir(), file))
    if (job.clientId === clientId && !['succeeded', 'failed', 'validation_failed'].includes(job.state)) {
      count += 1
    }
  }
  return count
}

function updateJob(jobId, patch) {
  const job = readJob(jobId)
  if (!job) return null
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() }
  writeJobAtomic(next)
  return next
}

module.exports = {
  jobsDir,
  assertJobId,
  readJob,
  writeJobAtomic,
  createJob,
  updateJob,
  findByIdempotency,
  listJobs,
  listQueuedJobsForDispatch,
  countJobsForClient
}
