const fs = require('fs')

function readLockRecord(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim()
    try {
      return JSON.parse(raw)
    } catch {
      return null
    }
  } catch {
    return null
  }
}

function lockIdentityMatches(current, expected) {
  if (!current || !expected) return false
  if (expected.token != null && current.token !== expected.token) return false
  if (expected.pid != null && current.pid !== expected.pid) return false
  if (expected.acquiredAt != null && current.acquiredAt !== expected.acquiredAt) return false
  return true
}

let __testOnlyPauseBeforeUnlink = null

function __testOnlySetPauseBeforeUnlink(hook) {
  __testOnlyPauseBeforeUnlink = hook
}

function compareAndUnlinkLockFile(filePath, expectedIdentity) {
  if (!fs.existsSync(filePath)) return { removed: false }
  const current = readLockRecord(filePath)
  if (!lockIdentityMatches(current, expectedIdentity)) {
    return { removed: false, stale: true }
  }
  if (__testOnlyPauseBeforeUnlink) {
    __testOnlyPauseBeforeUnlink({ filePath, expectedIdentity, current })
  }
  try {
    fs.unlinkSync(filePath)
    return { removed: true }
  } catch (err) {
    if (err.code === 'ENOENT') return { removed: false }
    throw err
  }
}

function mayReclaimLockRecord(rec, isPidConfirmedDeadFn) {
  if (!rec) return false
  if (rec.pid == null || !Number.isInteger(rec.pid)) return false
  return isPidConfirmedDeadFn(rec.pid)
}

module.exports = {
  readLockRecord,
  lockIdentityMatches,
  compareAndUnlinkLockFile,
  mayReclaimLockRecord,
  __testOnlySetPauseBeforeUnlink
}
