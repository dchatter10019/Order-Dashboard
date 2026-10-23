#!/usr/bin/env node
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const jobRoot = process.argv[2]
const jobId = process.argv[3]
const pausedFile = process.argv[4]
const proceedFile = process.argv[5]
const outFile = process.argv[6]
if (!jobRoot || !jobId || !pausedFile || !proceedFile || !outFile) process.exit(2)

process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot
process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

const {
  reconcileGatewayJob,
  __testOnlySetPauseAfterReconcileJobRead,
  __testOnlySetFetchJobBoundArtifact
} = require('../lib/analyticsGateway/reconcileJob.cjs')

__testOnlySetFetchJobBoundArtifact(async () => ({
  ok: false,
  code: 'missing_result',
  message: 'synthetic stub — not a live provider call'
}))

__testOnlySetPauseAfterReconcileJobRead(async () => {
  fs.writeFileSync(pausedFile, 'paused\n')
  const start = Date.now()
  while (!fs.existsSync(proceedFile) && Date.now() - start < 30_000) sleep(25)
})

try {
  const result = await reconcileGatewayJob(jobId, { forceRevalidate: true })
  fs.writeFileSync(outFile, `${JSON.stringify({ result, state: require('../lib/analyticsGateway/jobStore.cjs').readJob(jobId)?.state })}\n`)
  process.exit(0)
} catch (err) {
  fs.writeFileSync(outFile, `${JSON.stringify({ error: err.message })}\n`)
  process.exit(1)
}
