#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const { hashCanonicalArguments } = require('../lib/analyticsGateway/canonicalJson.cjs')
const { wrapHandlerArtifact } = require('../lib/analyticsGateway/jobBinding.cjs')
const { finalizeValidatedJob } = require('../lib/analyticsGateway/jobValidation.cjs')
const { writeJobAtomic } = require('../lib/analyticsGateway/jobStore.cjs')
const { validateStructuredResult } = require('../lib/analyticsGateway/resultRetrieval.cjs')
const {
  buildLiveSmokeReport,
  liveSmokeReportExitCode,
  sha256HexBuffer
} = require('../lib/analyticsGateway/liveSmokeReportValidation.cjs')

const samplePath = path.join(
  __dirname,
  '..',
  'test-fixtures',
  'analytics-gateway',
  'artifacts',
  'decision_support_v3.sample.json'
)
const sampleBase = JSON.parse(fs.readFileSync(samplePath, 'utf8'))

const savedJobsDir = process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'live-smoke-report-test-'))
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = tmpRoot

function makeJob(jobId = '00000000-0000-4000-8000-0000000000a1') {
  const args = { as_of: '2026-10-02' }
  return {
    jobId,
    clientId: 'test',
    operation: 'bevvi_analysis_data_quality',
    arguments: args,
    pythonArguments: args,
    requestHash: hashCanonicalArguments(args),
    state: 'queued'
  }
}

function handlerForJob(job) {
  const handler = JSON.parse(JSON.stringify(sampleBase))
  handler.provenance.as_of = job.arguments.as_of
  handler.provenance.settled_through = job.arguments.as_of
  handler.generated_at_utc = '2026-10-04T12:00:00+00:00'
  return handler
}

function persistSucceededJob(job, wrappedPayload, assetIdentity) {
  const finalized = finalizeValidatedJob({
    job,
    rawResult: wrappedPayload,
    assetIdentity,
    gatewayMode: 'smoke'
  })
  assert.strictEqual(finalized.ok, true, JSON.stringify(finalized))
  writeJobAtomic({
    ...job,
    state: finalized.state,
    resultEnvelope: finalized.envelope
  })
  return finalized.envelope
}

function assetIdentityForBytes(jobId, bytes) {
  return {
    id: 'asset-test-id',
    entry_id: 'entry-test-id',
    name: `${jobId}.json`,
    version: null,
    byte_digest: sha256HexBuffer(bytes)
  }
}

try {
  const job = makeJob()
  const handler = handlerForJob(job)
  const wrapped = wrapHandlerArtifact(job, handler)
  const artifactBytes = Buffer.from(JSON.stringify(wrapped), 'utf8')
  const assetIdentity = assetIdentityForBytes(job.jobId, artifactBytes)
  const envelope = persistSucceededJob(job, wrapped, assetIdentity)

  const passReport = buildLiveSmokeReport({
    jobId: job.jobId,
    envelope,
    meta: { test: true },
    artifactBytes
  })
  assert.strictEqual(passReport.identity_validation.envelope.ok, true)
  assert.strictEqual(passReport.identity_validation.artifact_revalidation.status, 'pass')
  assert.strictEqual(passReport.identity_validation.handler_only_not_wrapped_artifact.ok, true)
  assert.strictEqual(liveSmokeReportExitCode(passReport), 0)

  const badBinding = wrapHandlerArtifact(job, handler)
  badBinding.gateway_job_binding.job_id = '00000000-0000-4000-8000-000000000099'
  const badBindingBytes = Buffer.from(JSON.stringify(badBinding), 'utf8')
  const badBindingReport = buildLiveSmokeReport({
    jobId: job.jobId,
    envelope,
    meta: {},
    artifactBytes: badBindingBytes
  })
  assert.strictEqual(badBindingReport.identity_validation.artifact_revalidation.status, 'fail')
  assert.ok(badBindingReport.unresolved.length > 0)
  assert.strictEqual(liveSmokeReportExitCode(badBindingReport), 1)

  const digestMismatchReport = buildLiveSmokeReport({
    jobId: job.jobId,
    envelope,
    meta: {},
    artifactBytes: Buffer.from(JSON.stringify(wrapped) + ' ', 'utf8')
  })
  assert.strictEqual(digestMismatchReport.identity_validation.artifact_revalidation.code, 'digest_mismatch')
  assert.strictEqual(liveSmokeReportExitCode(digestMismatchReport), 1)

  const legacyFalseNegative = validateStructuredResult({
    job,
    payload: envelope.result,
    assetIdentity: envelope.provenance.asset_identity,
    requireBinding: true
  })
  assert.strictEqual(legacyFalseNegative.ok, false)
  assert.strictEqual(legacyFalseNegative.code, 'missing_binding')
  const handlerOnlyReport = buildLiveSmokeReport({
    jobId: job.jobId,
    envelope,
    meta: {},
    artifactBytes
  })
  assert.strictEqual(handlerOnlyReport.identity_validation.consumer_handler.ok, true)
  assert.strictEqual(handlerOnlyReport.identity_validation.artifact_revalidation.status, 'pass')

  const unavailableReport = buildLiveSmokeReport({
    jobId: job.jobId,
    envelope,
    meta: {},
    artifactBytes: null
  })
  assert.strictEqual(unavailableReport.identity_validation.artifact_revalidation.status, 'unavailable')
  assert.ok(unavailableReport.unresolved.includes('artifact_revalidation_unavailable'))
  assert.strictEqual(liveSmokeReportExitCode(unavailableReport), 1)

  console.log('analytics-gateway-live-smoke-report-test: OK')
} finally {
  if (savedJobsDir === undefined) delete process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR
  else process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = savedJobsDir
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
