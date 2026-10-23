#!/usr/bin/env node
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const workerLoaded = false

const { applyArtifactValidation } = require('../lib/analyticsGateway/reconcileJob.cjs')
const { readJob } = require('../lib/analyticsGateway/jobStore.cjs')
const { wrapHandlerArtifact } = require('../lib/analyticsGateway/jobBinding.cjs')
const { buildMockHandlerResult } = require('../lib/analyticsGateway/mockHandlerResult.cjs')

const jobId = process.argv[2]
if (!jobId) process.exit(2)

const job = readJob(jobId)
const handler = buildMockHandlerResult({ operation: job.operation, args: job.arguments })
const wrapped = wrapHandlerArtifact(job, handler)
const outcome = await applyArtifactValidation(jobId, {
  ok: true,
  payload: wrapped,
  assetIdentity: { name: `${jobId}.json`, byte_digest: 'b'.repeat(64) }
})

process.stdout.write(
  JSON.stringify({
    ok: outcome.ok === true,
    workerLoaded
  })
)
