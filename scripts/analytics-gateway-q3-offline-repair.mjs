#!/usr/bin/env node
// No dotenv, server startup, network, or implicit default-store execution.
import fs from 'node:fs'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const args = process.argv.slice(2)
if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
  console.log('Separate execution approval required. Usage: --plan ABSOLUTE_PATH --approved-plan-sha256 HEX --execute-approved-q3-repair')
  process.exit(0)
}
if (args.length !== 5 || args[0] !== '--plan' || args[2] !== '--approved-plan-sha256' ||
    args[4] !== '--execute-approved-q3-repair') {
  console.error('CHECKPOINT: explicit reviewed plan and separate execution approval required')
  process.exit(1)
}
try {
  const bytes = fs.readFileSync(args[1])
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== args[3]) throw new Error('plan_digest_mismatch')
  const plan = JSON.parse(bytes)
  if (typeof plan.jobs_dir !== 'string' || !plan.jobs_dir.startsWith('/')) throw new Error('absolute_jobs_dir_required')
  if (process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR &&
      process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR !== plan.jobs_dir) throw new Error('store_env_conflict')
  process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = plan.jobs_dir
  const { repairOfflineArtifact } = require('../lib/analyticsGateway/offlineArtifactRepair.cjs')
  const result = repairOfflineArtifact({
    planPath: args[1], approvedPlanSha256: args[3], executionApproved: true,
    policy: {
      jobId: '6a529ed9-0f69-422f-a9c9-e6c52da717ad',
      jobSha256: '215439d1b689b04cf92ae108a2e15711c50d675295b9b941c2956251c0faee0a',
      artifactSha256: '61d4d1685efff6b6e97b733427a38cda4a38adc24b1401748527d83e8802cee7',
      operation: 'bevvi_planning_forecast',
      arguments: { as_of: '2026-10-02', model: 'planning_blend_v1' },
      requestHash: '9d7a8cc7a087f42ab1c60426b40605783b16511c256087bdd6ae10162b497cac',
      threadId: '40f3ef7a-ab04-486c-9e52-9c2485d1cec8',
      idempotencyKey: 'approved-local-test-2026-10-04-planning_forecast_30d-e3c8dd5e-7bdf-49d1-8b0c-ac55aa5be7b6',
      assetId: 'a25d704a-144d-463d-98be-6491c56fdbdf'
    }
  })
  console.log(JSON.stringify(result, null, 2))
  process.exitCode = result.ok ? 0 : 1
} catch {
  console.error('CHECKPOINT: invalid or unreadable approved plan; no repair attempted')
  process.exitCode = 1
}
