#!/usr/bin/env node
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const jobRoot = process.argv[2]
const outFile = process.argv[3]
if (!jobRoot || !outFile) process.exit(2)

process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot

const { acquireGatewayMaintenanceStoreOwnership } = require('../lib/analyticsGateway/gatewayStoreSingleton.cjs')
const result = acquireGatewayMaintenanceStoreOwnership()
fs.writeFileSync(outFile, `${JSON.stringify(result)}\n`)
if (result.ok) result.release()
process.exit(result.ok ? 0 : 1)
