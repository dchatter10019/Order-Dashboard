#!/usr/bin/env node
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const jobId = process.argv[2]
const pausedFile = process.argv[3]
const outFile = process.argv[4]
if (!jobId || !pausedFile || !outFile) process.exit(2)

const { withProcessingLeaseGate } = require('../lib/analyticsGateway/jobClaim.cjs')

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const start = Date.now()
while (!fs.existsSync(pausedFile) && Date.now() - start < 30_000) sleep(25)
sleep(50)

const gated = withProcessingLeaseGate(jobId, () => {
  sleep(400)
  return 'B'
})
fs.writeFileSync(outFile, `${JSON.stringify(gated)}\n`)
