#!/usr/bin/env node
import fs from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

const jobRoot = process.argv[2]
const readyFile = process.argv[3]
if (!jobRoot || !readyFile) process.exit(2)

process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = jobRoot

const { acquireGatewayMaintenanceStoreOwnership } = require('../lib/analyticsGateway/gatewayStoreSingleton.cjs')

const owned = acquireGatewayMaintenanceStoreOwnership()
if (!owned.ok) {
  process.stderr.write(`${JSON.stringify(owned)}\n`)
  process.exit(1)
}

fs.writeFileSync(readyFile, 'holding\n')
setInterval(() => {}, 60_000)
