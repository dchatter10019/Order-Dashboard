#!/usr/bin/env node
import assert from 'assert'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const saved = { ...process.env }
process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = path.join(
  __dirname,
  '..',
  'data',
  'analytics-gateway',
  'delayed-delivery-jobs'
)

let nowMs = Date.parse('2026-10-04T12:00:00Z')
const { writeJobAtomic, readJob } = require('../lib/analyticsGateway/jobStore.cjs')
const { applyUpstreamOutcome } = require('../lib/analyticsGateway/worker.cjs')
const {
  startArtifactRetryScheduler,
  stopArtifactRetryScheduler,
  __testOnlyRunDueRetries
} = require('../lib/analyticsGateway/artifactRetryScheduler.cjs')
const { resumeArtifactDelivery } = require('../lib/analyticsGateway/worker.cjs')

const jobId = '00000000-0000-4000-8000-0000000000d1'
writeJobAtomic({
  jobId,
  clientId: 'test',
  operation: 'bevvi_analysis_data_quality',
  arguments: { as_of: '2026-10-02' },
  pythonArguments: { as_of: '2026-10-02' },
  requestHash: 'abc',
  state: 'awaiting_artifact',
  gatewayExecutionMode: 'mock',
  computerTaskSubmitted: true,
  artifactRetryCount: 1,
  artifactNextRetryAt: new Date(nowMs + 2000).toISOString(),
  createdAt: new Date(nowMs).toISOString(),
  updatedAt: new Date(nowMs).toISOString()
})

let resumeCount = 0
const resumeStub = (id) => {
  resumeCount += 1
  applyUpstreamOutcome(id, {
    ok: true,
    mode: 'mock',
    result: require('../lib/analyticsGateway/computerMcpClient.cjs').runMockAnalyticsJob({
      operation: 'bevvi_analysis_data_quality',
      arguments: { as_of: '2026-10-02' },
      jobId: id
    }).then((r) => r)
  })
}

startArtifactRetryScheduler(async (id) => {
  const job = readJob(id)
  if (!job || job.state !== 'awaiting_artifact') return
  if (job.artifactNextRetryAt && Date.parse(job.artifactNextRetryAt) > nowMs) return
  resumeCount += 1
  const upstream = await require('../lib/analyticsGateway/computerMcpClient.cjs').runMockAnalyticsJob({
    operation: job.operation,
    arguments: job.arguments,
    jobId: id
  })
  applyUpstreamOutcome(id, upstream)
}, { nowFn: () => nowMs, tickMs: 100 })

assert.strictEqual(readJob(jobId).state, 'awaiting_artifact')
nowMs += 3000
__testOnlyRunDueRetries()
await new Promise((r) => setTimeout(r, 400))

const done = readJob(jobId)
assert.strictEqual(done.state, 'succeeded')
assert.ok(resumeCount >= 1)

stopArtifactRetryScheduler()
process.env = saved

console.log('analytics-gateway-delayed-delivery-test: OK')
