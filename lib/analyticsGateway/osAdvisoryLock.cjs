const fs = require('fs')
const path = require('path')
const ext = require('fs-ext')
const { jobsDir } = require('./jobStore.cjs')

const LOCK_DIRNAME = '.os-mutex'
const SIGNAL_MUTEX_SEGMENT = 'queued-dispatch.signal.mutex'

/** @type {Map<string, { fd: number, depth: number }>} */
const heldInProcess = new Map()

let __testOnlyPauseAfterAcquire = null

function __testOnlySetPauseAfterAcquire(hook) {
  __testOnlyPauseAfterAcquire = hook
}

function assertSafeMutexSegment(segment) {
  if (typeof segment !== 'string' || !segment.length) {
    throw Object.assign(new Error('mutex segment required'), { code: 'mutex_path_unsafe' })
  }
  if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
    throw Object.assign(new Error('mutex segment must be a flat filename'), { code: 'mutex_path_unsafe' })
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(segment)) {
    throw Object.assign(new Error('mutex segment contains unsafe characters'), { code: 'mutex_path_unsafe' })
  }
}

function assertDirectoryNotSymlink(dirPath, code, message) {
  if (!fs.existsSync(dirPath)) return
  const st = fs.lstatSync(dirPath)
  if (st.isSymbolicLink()) {
    throw Object.assign(new Error(message), { code })
  }
  if (!st.isDirectory()) {
    throw Object.assign(new Error(`${message}: not a directory`), { code: 'mutex_path_unsafe' })
  }
}

function resolveTrustedMutexRoot() {
  const jobsPath = path.resolve(jobsDir())
  assertDirectoryNotSymlink(jobsPath, 'mutex_jobs_dir_symlink_rejected', 'jobs directory must not be a symlink')
  fs.mkdirSync(jobsPath, { recursive: true, mode: 0o700 })
  const root = path.join(jobsPath, LOCK_DIRNAME)
  assertDirectoryNotSymlink(root, 'mutex_root_symlink_rejected', 'mutex root must not be a symlink')
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { mode: 0o700 })
    assertDirectoryNotSymlink(root, 'mutex_root_symlink_rejected', 'mutex root must not be a symlink')
  }
  return root
}

function resolveTrustedMutexPath(segment) {
  assertSafeMutexSegment(segment)
  const root = resolveTrustedMutexRoot()
  const candidate = path.resolve(root, segment)
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
    throw Object.assign(new Error('mutex path escapes lock root'), { code: 'mutex_path_unsafe' })
  }
  return candidate
}

function openFlagsNoFollow() {
  if (!fs.constants.O_NOFOLLOW) {
    throw Object.assign(new Error('O_NOFOLLOW is not supported on this platform'), {
      code: 'advisory_lock_unavailable'
    })
  }
  return fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW
}

function openMutexFileDescriptor(mutexPath) {
  fs.mkdirSync(path.dirname(mutexPath), { recursive: true, mode: 0o700 })
  let fd
  try {
    fd = fs.openSync(mutexPath, openFlagsNoFollow(), 0o600)
    const st = fs.fstatSync(fd)
    if (!st.isFile()) {
      throw Object.assign(new Error('mutex path is not a regular file'), { code: 'mutex_not_regular_file' })
    }
    return fd
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
    if (err && err.code === 'ELOOP') {
      throw Object.assign(new Error('mutex path is a symlink'), {
        code: 'mutex_symlink_rejected',
        cause: err
      })
    }
    throw err
  }
}

let __testOnlyFlockSyncImpl = null

function __testOnlySetFlockSyncImpl(impl) {
  __testOnlyFlockSyncImpl = impl
}

function tryAcquireExclusiveNonblocking(fd) {
  try {
    if (__testOnlyFlockSyncImpl) {
      __testOnlyFlockSyncImpl(fd, 'exnb')
    } else {
      ext.flockSync(fd, 'exnb')
    }
    return true
  } catch (err) {
    if (err && (err.code === 'EWOULDBLOCK' || err.code === 'EAGAIN')) return false
    throw err
  }
}

function unlockAndClose(fd) {
  try {
    ext.flockSync(fd, 'un')
  } catch {
    /* ignore unlock errors on close */
  }
  fs.closeSync(fd)
}

function rejectAsyncCallback(fn) {
  if (fn.constructor && fn.constructor.name === 'AsyncFunction') {
    throw Object.assign(new Error('async mutex callback not supported'), { code: 'mutex_async_rejected' })
  }
}

function assertSynchronousCallbackResult(value) {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    if (typeof value.then === 'function') {
      throw Object.assign(new Error('mutex callback returned a Promise or thenable'), {
        code: 'mutex_async_result_rejected'
      })
    }
  }
  return value
}

function invokeMutexCallback(fn) {
  rejectAsyncCallback(fn)
  return assertSynchronousCallbackResult(fn())
}

function jobProcessingMutexSegment(jobId) {
  if (typeof jobId !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(jobId)) {
    throw Object.assign(new Error('unsafe job id for processing mutex'), { code: 'mutex_path_unsafe' })
  }
  return `processing-${jobId}.mutex`
}

function mutexPathForSegment(segment) {
  return resolveTrustedMutexPath(segment)
}

function withExclusiveAdvisoryLock(mutexSegment, fn) {
  if (typeof fn !== 'function') {
    throw Object.assign(new Error('mutex callback must be a function'), { code: 'mutex_invalid_callback' })
  }
  rejectAsyncCallback(fn)

  const mutexPath = resolveTrustedMutexPath(mutexSegment)
  const reentry = heldInProcess.get(mutexPath)
  if (reentry) {
    reentry.depth += 1
    try {
      return { ok: true, value: invokeMutexCallback(fn), reentrant: true }
    } finally {
      reentry.depth -= 1
    }
  }

  let fd
  try {
    fd = openMutexFileDescriptor(mutexPath)
    if (!tryAcquireExclusiveNonblocking(fd)) {
      fs.closeSync(fd)
      return { ok: false, code: 'mutex_busy', message: 'Advisory mutex busy' }
    }
    if (__testOnlyPauseAfterAcquire) {
      __testOnlyPauseAfterAcquire({ mutexPath, mutexSegment })
    }
    heldInProcess.set(mutexPath, { fd, depth: 1 })
    try {
      return { ok: true, value: invokeMutexCallback(fn) }
    } finally {
      const entry = heldInProcess.get(mutexPath)
      if (!entry) return
      entry.depth -= 1
      if (entry.depth <= 0) {
        heldInProcess.delete(mutexPath)
        unlockAndClose(entry.fd)
      }
    }
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
    throw err
  }
}

function acquireAdvisoryLockHold(mutexSegment) {
  const mutexPath = resolveTrustedMutexPath(mutexSegment)
  let fd
  try {
    fd = openMutexFileDescriptor(mutexPath)
    try {
      if (!tryAcquireExclusiveNonblocking(fd)) {
        fs.closeSync(fd)
        return { ok: false, code: 'mutex_busy', message: 'Advisory mutex busy' }
      }
    } catch (err) {
      fs.closeSync(fd)
      throw err
    }
    let released = false
    return {
      ok: true,
      mutexPath,
      release() {
        if (released) return
        released = true
        unlockAndClose(fd)
      }
    }
  } catch (err) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
    throw err
  }
}

function __testOnlyAcquireAndHold(mutexSegment) {
  return acquireAdvisoryLockHold(mutexSegment)
}

function assertAdvisoryLockCapability() {
  try {
    const probePath = resolveTrustedMutexPath('.capability-probe.mutex')
    const fd = openMutexFileDescriptor(probePath)
    try {
      if (!tryAcquireExclusiveNonblocking(fd)) {
        throw new Error('capability probe lock busy')
      }
      ext.flockSync(fd, 'un')
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    throw Object.assign(
      new Error(`OS advisory lock unavailable (fs-ext flock): ${err.message}`),
      { code: 'advisory_lock_unavailable', cause: err }
    )
  }
}

module.exports = {
  LOCK_DIRNAME,
  SIGNAL_MUTEX_SEGMENT,
  jobProcessingMutexSegment,
  mutexPathForSegment,
  resolveTrustedMutexRoot,
  withExclusiveAdvisoryLock,
  acquireAdvisoryLockHold,
  __testOnlySetFlockSyncImpl,
  assertAdvisoryLockCapability,
  __testOnlySetPauseAfterAcquire,
  __testOnlyAcquireAndHold,
  __testOnlyHeldInProcessCount: () => heldInProcess.size
}
