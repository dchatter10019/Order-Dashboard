#!/usr/bin/env node
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const jobId = process.argv[2]
const pausedFile = process.argv[3]
const proceedFile = process.argv[4]
const insideFile = process.argv[5]
const outFile = process.argv[6]
const label = process.argv[7] || '?'
if (!jobId || !pausedFile || !proceedFile || !insideFile || !outFile) process.exit(2)

const { withProcessingLeaseGate } = require('../lib/analyticsGateway/jobClaim.cjs')
const { __testOnlySetPauseAfterAcquire } = require('../lib/analyticsGateway/osAdvisoryLock.cjs')

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

if (label === 'A') {
  __testOnlySetPauseAfterAcquire(() => {
    fs.writeFileSync(pausedFile, 'paused\n')
    const start = Date.now()
    while (!fs.existsSync(proceedFile) && Date.now() - start < 30_000) sleep(25)
  })
}

if (label === 'B') {
  const start = Date.now()
  while (!fs.existsSync(pausedFile) && Date.now() - start < 30_000) sleep(25)
}

const gated = withProcessingLeaseGate(jobId, () => {
  fs.writeFileSync(insideFile, `${label}\n`)
  sleep(500)
  return label
})
fs.writeFileSync(outFile, `${JSON.stringify(gated)}\n`)
