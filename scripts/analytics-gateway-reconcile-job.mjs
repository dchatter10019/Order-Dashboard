#!/usr/bin/env node
/**
 * Reconcile one job from job-bound asset only (no Computer recalculation).
 * Usage: node scripts/analytics-gateway-reconcile-job.mjs <jobId> [--force]
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const require = createRequire(import.meta.url)
const { reconcileGatewayJob } = require('../lib/analyticsGateway/reconcileJob.cjs')
const { validateEnvelopeForJob } = require('../lib/analyticsGateway/resultEnvelope.cjs')
const { readJob } = require('../lib/analyticsGateway/jobStore.cjs')

const jobId = process.argv[2]
const force = process.argv.includes('--force')
if (!jobId) {
  console.error('Usage: node scripts/analytics-gateway-reconcile-job.mjs <jobId> [--force]')
  process.exit(1)
}

const outcome = await reconcileGatewayJob(jobId, { forceRevalidate: force })
const job = readJob(jobId)

const report = {
  jobId,
  reconcile_ok: outcome.ok,
  state: job?.state,
  error: job?.error || null,
  asset_identity: outcome.assetIdentity || job?.resultEnvelope?.provenance?.asset_identity || null,
  gateway_mode: job?.resultEnvelope?.gateway_mode ?? null,
  handler_live_gate_status: job?.resultEnvelope?.handler_live_gate_status ?? null,
  identity_validation: null,
  certification_warnings: job?.resultEnvelope?.certification_warnings || [],
  integration_test_passed: job?.resultEnvelope?.integration_test_passed ?? false,
  data_quality_certified: job?.resultEnvelope?.data_quality_certified ?? false,
  production_readiness_approved: job?.resultEnvelope?.production_readiness_approved ?? false,
  audit_events: (job?.auditHistory || []).map((e) => e.event)
}

if (job?.resultEnvelope) {
  const envErr = validateEnvelopeForJob(job.resultEnvelope, job)
  report.identity_validation = envErr ? { ok: false, message: envErr } : { ok: true }
}

if (!outcome.ok) {
  report.blocker = outcome.code || outcome.error?.code
  report.message = outcome.message || outcome.error?.message
}

console.log(JSON.stringify(report, null, 2))
process.exit(outcome.ok ? 0 : 1)
