#!/usr/bin/env node
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const jobId = process.argv[2]
const pausedFile = process.argv[3]
const proceedFile = process.argv[4]
const outFile = process.argv[5]
if (!jobId || !pausedFile || !proceedFile || !outFile) process.exit(2)

const { withProcessingLeaseGate } = require('../lib/analyticsGateway/jobClaim.cjs')
const { __testOnlySetPauseAfterAcquire } = require('../lib/analyticsGateway/osAdvisoryLock.cjs')

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

__testOnlySetPauseAfterAcquire(() => {
  fs.writeFileSync(pausedFile, 'paused\n')
  const start = Date.now()
  while (!fs.existsSync(proceedFile) && Date.now() - start < 30_000) sleep(25)
})

const gated = withProcessingLeaseGate(jobId, () => {
  sleep(400)
  return 'A'
})
fs.writeFileSync(outFile, `${JSON.stringify(gated)}\n`)
