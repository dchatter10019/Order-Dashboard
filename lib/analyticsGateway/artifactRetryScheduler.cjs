const fs = require('fs')
const path = require('path')
const { jobsDir } = require('./jobStore.cjs')

let timer = null
let resumeFn = null
let nowFn = () => Date.now()
const TICK_MS = 500

function listDueArtifactJobs(nowMs = nowFn()) {
  let files = []
  try {
    files = fs.readdirSync(jobsDir()).filter((f) => f.endsWith('.json') && !f.startsWith('.'))
  } catch {
    return []
  }
  const due = []
  for (const file of files) {
    const job = JSON.parse(fs.readFileSync(path.join(jobsDir(), file), 'utf8'))
    if (job.state !== 'awaiting_artifact') continue
    if (!job.computerTaskSubmitted) continue
    if (!job.artifactNextRetryAt) continue
    if (Date.parse(job.artifactNextRetryAt) <= nowMs) due.push(job.jobId)
  }
  return due
}

function tick() {
  if (!resumeFn) return
  for (const jobId of listDueArtifactJobs()) {
    resumeFn(jobId)
  }
}

function startArtifactRetryScheduler(fn, options = {}) {
  resumeFn = fn
  if (options.nowFn) nowFn = options.nowFn
  if (timer) return
  timer = setInterval(tick, options.tickMs || TICK_MS)
  if (typeof timer.unref === 'function') timer.unref()
}

function stopArtifactRetryScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}

function __testOnlyRunDueRetries() {
  tick()
}

module.exports = {
  startArtifactRetryScheduler,
  stopArtifactRetryScheduler,
  listDueArtifactJobs,
  __testOnlyRunDueRetries
}
