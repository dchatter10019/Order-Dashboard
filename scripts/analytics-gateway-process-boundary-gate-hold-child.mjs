#!/usr/bin/env node
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const jobId = process.argv[2]
const readyFile = process.argv[3]
if (!jobId || !readyFile) process.exit(2)

const { withProcessingLeaseGate } = require('../lib/analyticsGateway/jobClaim.cjs')

const gated = withProcessingLeaseGate(jobId, () => {
  fs.writeFileSync(readyFile, 'holding\n')
  execSync('sleep 3600')
  return { ok: true }
})

if (!gated.ok) {
  process.stderr.write(JSON.stringify(gated))
  process.exit(1)
}
