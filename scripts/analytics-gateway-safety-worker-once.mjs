#!/usr/bin/env node
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const jobId = process.argv[2]
const ownerId = process.argv[3]
if (!jobId || !ownerId) process.exit(2)

process.env.BEVVI_ANALYTICS_GATEWAY_MODE = process.env.BEVVI_ANALYTICS_GATEWAY_MODE || 'mock'

const { __testOnlySetSubmitSpy } = require('../lib/analyticsGateway/computerMcpClient.cjs')
const { processJob } = require('../lib/analyticsGateway/worker.cjs')

let submits = 0
__testOnlySetSubmitSpy(() => {
  submits += 1
})

await processJob(jobId, { ownerId })
process.stdout.write(String(submits))
