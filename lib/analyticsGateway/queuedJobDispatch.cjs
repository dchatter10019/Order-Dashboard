const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { jobsDir, listQueuedJobsForDispatch } = require('./jobStore.cjs')
const {
  SIGNAL_MUTEX_SEGMENT,
  mutexPathForSegment,
  withExclusiveAdvisoryLock
} = require('./osAdvisoryLock.cjs')

const SIGNAL_BASENAME = 'queued-dispatch.signal.json'
const DEFAULT_TICK_MS = 500

let dispatchFn = null
let timer = null
let lastSeenSeq = 0
let __testOnlyBeforeSignalPublish = null

function signalPath() {
  return path.join(jobsDir(), SIGNAL_BASENAME)
}

function signalWriteLockPath() {
  return mutexPathForSegment(SIGNAL_MUTEX_SEGMENT)
}

function readSignal() {
  try {
    return JSON.parse(fs.readFileSync(signalPath(), 'utf8'))
  } catch {
    return null
  }
}

function withSignalWriteLock(fn) {
  fs.mkdirSync(jobsDir(), { recursive: true, mode: 0o700 })
  const locked = withExclusiveAdvisoryLock(SIGNAL_MUTEX_SEGMENT, fn)
  if (!locked.ok && locked.code === 'mutex_busy') {
    throw Object.assign(new Error('Dispatch signal write lock busy'), { code: 'signal_write_busy' })
  }
  if (!locked.ok) {
    throw Object.assign(new Error(locked.message || 'Dispatch signal mutex failed'), {
      code: locked.code || 'signal_mutex_failed'
    })
  }
  return locked.value
}

function publishQueuedJobDispatchSignal(reason = 'admission_released') {
  try {
    return withSignalWriteLock(() => {
      const prior = readSignal()
      const next = {
        seq: (prior?.seq || 0) + 1,
        at: new Date().toISOString(),
        pid: process.pid,
        reason,
        nonce: crypto.randomUUID()
      }
      if (__testOnlyBeforeSignalPublish) {
        __testOnlyBeforeSignalPublish(next)
      }
      const tmp = `${signalPath()}.${process.pid}.${Date.now()}.tmp`
      fs.writeFileSync(tmp, `${JSON.stringify(next)}\n`, { encoding: 'utf8', mode: 0o600 })
      fs.renameSync(tmp, signalPath())
      return { ok: true, signal: next }
    })
  } catch (err) {
    if (err.code === 'signal_write_busy') {
      return { ok: false, code: 'signal_write_busy', coalesced: true }
    }
    throw err
  }
}

function signalQueuedJobDispatchRequest(reason = 'admission_released') {
  const result = publishQueuedJobDispatchSignal(reason)
  return result.ok ? result.signal : result
}

function runQueuedJobDispatchTick() {
  if (!dispatchFn) return { dispatched: 0 }
  const signal = readSignal()
  const seqAdvanced = Boolean(signal?.seq && signal.seq > lastSeenSeq)
  if (signal?.seq && signal.seq > lastSeenSeq) lastSeenSeq = signal.seq

  const waiting = listQueuedJobsForDispatch()
  if (!waiting.length) {
    return { dispatched: 0, skipped: !seqAdvanced, seq: signal?.seq || null }
  }

  for (const job of waiting) {
    dispatchFn(job.jobId).catch(() => {})
  }
  return { dispatched: waiting.length, seq: signal?.seq || null, skipped: false }
}

function startQueuedJobDispatchWatcher(fn, options = {}) {
  dispatchFn = fn
  if (timer) return
  const tickMs = options.tickMs || DEFAULT_TICK_MS
  const boot = readSignal()
  if (boot?.seq) lastSeenSeq = boot.seq
  timer = setInterval(() => runQueuedJobDispatchTick(), tickMs)
  if (typeof timer.unref === 'function') timer.unref()
}

function stopQueuedJobDispatchWatcher() {
  if (timer) clearInterval(timer)
  timer = null
}

function __testOnlySetDispatchFn(fn) {
  dispatchFn = fn
}

function __testOnlySetBeforeSignalPublish(hook) {
  __testOnlyBeforeSignalPublish = hook
}

function __testOnlyResetDispatchWatcherState() {
  lastSeenSeq = readSignal()?.seq || 0
}

module.exports = {
  signalQueuedJobDispatchRequest,
  publishQueuedJobDispatchSignal,
  startQueuedJobDispatchWatcher,
  stopQueuedJobDispatchWatcher,
  runQueuedJobDispatchTick,
  readSignal,
  signalWriteLockPath,
  __testOnlySetBeforeSignalPublish,
  __testOnlyResetDispatchWatcherState,
  __testOnlySetDispatchFn
}
