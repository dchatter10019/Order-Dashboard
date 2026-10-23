#!/usr/bin/env node
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const lockFile = process.argv[2]
const pausedFile = process.argv[3]
const proceedFile = process.argv[4]
const outFile = process.argv[5]
const label = process.argv[6]
if (!lockFile || !outFile || !label) process.exit(2)

const {
  compareAndUnlinkLockFile,
  __testOnlySetPauseBeforeUnlink
} = require('../lib/analyticsGateway/durableLockFile.cjs')

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const staleIdentity = {
  token: 'stale-token',
  pid: 999999,
  acquiredAt: new Date(0).toISOString()
}

if (label === 'A') {
  __testOnlySetPauseBeforeUnlink(() => {
    fs.writeFileSync(pausedFile, 'paused\n')
    const start = Date.now()
    while (!fs.existsSync(proceedFile) && Date.now() - start < 30_000) sleep(25)
  })
  const unlinkResult = compareAndUnlinkLockFile(lockFile, staleIdentity)
  fs.writeFileSync(outFile, `${JSON.stringify({ label, ...unlinkResult })}\n`)
  process.exit(0)
}

if (label === 'B') {
  const start = Date.now()
  while (!fs.existsSync(pausedFile) && Date.now() - start < 30_000) sleep(25)
  fs.writeFileSync(
    lockFile,
    `${JSON.stringify({
      token: 'live-token',
      pid: process.pid,
      acquiredAt: new Date().toISOString()
    })}\n`
  )
  fs.writeFileSync(outFile, `${JSON.stringify({ label, liveInstalled: true })}\n`)
}
