#!/usr/bin/env node
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { acquireArtifactDeliveryLease } = require('../lib/analyticsGateway/jobClaim.cjs')

const jobId = process.argv[2]
const ownerId = process.argv[3]
if (!jobId || !ownerId) process.exit(2)

const result = acquireArtifactDeliveryLease(jobId, ownerId)
process.stdout.write(JSON.stringify(result))
