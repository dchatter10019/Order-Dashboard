#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobRoot = path.join(__dirname, '..', 'data', 'analytics-gateway', 'os-lock-wrapper-jobs')
fs.rmSync(jobRoot, { recursive: true, force: true })
fs.mkdirSync(jobRoot, { recursive: true })

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'

const {
  LOCK_DIRNAME,
  withExclusiveAdvisoryLock,
  resolveTrustedMutexRoot,
  __testOnlyAcquireAndHold
} = require('../lib/analyticsGateway/osAdvisoryLock.cjs')

function openFdCount() {
  try {
    return fs.readdirSync(`/proc/${process.pid}/fd`).length
  } catch {
    try {
      return fs.readdirSync('/dev/fd').length
    } catch {
      return null
    }
  }
}

// Promise / thenable results must not be reported as lock-protected success
{
  const seg = `thenable-${Date.now()}.mutex`

  assert.throws(
    () => withExclusiveAdvisoryLock(seg, () => Promise.resolve(true)),
    (err) => err.code === 'mutex_async_result_rejected'
  )

  assert.throws(
    () => withExclusiveAdvisoryLock(seg, () => ({ then: (r) => r(true) })),
    (err) => err.code === 'mutex_async_result_rejected'
  )

  assert.throws(
    () =>
      withExclusiveAdvisoryLock(seg, () => {
        withExclusiveAdvisoryLock(seg, () => Promise.resolve('nested'))
        return 'outer'
      }),
    (err) => err.code === 'mutex_async_result_rejected'
  )

  assert.throws(
    () => withExclusiveAdvisoryLock(seg, async () => 'nope'),
    (err) => err.code === 'mutex_async_rejected'
  )

  const hold = __testOnlyAcquireAndHold(seg)
  assert.strictEqual(hold.ok, true)
  const contender = withExclusiveAdvisoryLock(seg, () => true)
  assert.strictEqual(contender.ok, false)
  assert.strictEqual(contender.code, 'mutex_busy')
  hold.release()

  const after = withExclusiveAdvisoryLock(seg, () => 'ok')
  assert.strictEqual(after.ok, true)
  assert.strictEqual(after.value, 'ok')
}

// Symlink leaf mutex path: reject without leaking descriptors
{
  const root = resolveTrustedMutexRoot()
  const outside = path.join(jobRoot, 'outside-target')
  fs.mkdirSync(outside, { recursive: true })
  const leafSegment = `symlink-leaf-${Date.now()}.mutex`
  const linkPath = path.join(root, leafSegment)
  const targetPath = path.join(outside, 'escaped.mutex')
  fs.symlinkSync(targetPath, linkPath)

  const before = openFdCount()
  for (let i = 0; i < 3; i += 1) {
    assert.throws(
      () => withExclusiveAdvisoryLock(leafSegment, () => 'never'),
      (err) => err.code === 'mutex_symlink_rejected'
    )
  }
  const after = openFdCount()
  if (before !== null && after !== null) {
    assert.strictEqual(after, before, `fd leak after symlink rejection (delta ${after - before})`)
  }
  assert.strictEqual(fs.existsSync(targetPath), false, 'must not create symlink target via lock open')
}

// Symlink mutex root must not redirect locks outside jobs dir
{
  const jobsPath = path.resolve(jobRoot)
  const altRoot = path.join(jobRoot, 'alt-mutex-root')
  fs.mkdirSync(altRoot, { recursive: true })
  const mutexLink = path.join(jobsPath, LOCK_DIRNAME)
  if (fs.existsSync(mutexLink)) {
    fs.rmSync(mutexLink, { recursive: true, force: true })
  }
  fs.symlinkSync(altRoot, mutexLink)

  assert.throws(
    () => withExclusiveAdvisoryLock(`root-symlink-${Date.now()}.mutex`, () => 'never'),
    (err) => err.code === 'mutex_root_symlink_rejected'
  )
  assert.strictEqual(fs.readdirSync(altRoot).length, 0, 'must not create mutex under redirected root')
}

fs.rmSync(jobRoot, { recursive: true, force: true })
console.log('analytics-gateway-os-advisory-lock-wrapper-test: OK')
