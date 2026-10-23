#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const {
  validateModeConfiguration,
  isLiveComputerMode,
  isOperationAllowedInMode,
  getRuntimeMode
} = require('../lib/analyticsGateway/modes.cjs')
const { validateStartupEnvironment } = require('../lib/analyticsGateway/gatewayLimits.cjs')
const {
  buildFreshManifest,
  writeManifestAtomic,
  validateLocalTestSubmission,
  markLocalTestSubmissionAttempted,
  manifestPath
} = require('../lib/analyticsGateway/localTestManifest.cjs')
const { requestAnalytics } = require('../lib/analyticsGateway/worker.cjs')
const { finalizeValidatedJob } = require('../lib/analyticsGateway/jobValidation.cjs')
const { wrapHandlerArtifact } = require('../lib/analyticsGateway/jobBinding.cjs')
const { __testOnlySetSubmitSpy } = require('../lib/analyticsGateway/computerMcpClient.cjs')

const savedEnv = { ...process.env }
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'local-test-mode-'))
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = path.join(tmpRoot, 'jobs')
process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_MANIFEST_PATH = path.join(tmpRoot, 'manifest.json')

function setEnv(overrides) {
  process.env = { ...savedEnv, ...overrides }
}

try {
  setEnv({
    BEVVI_ANALYTICS_GATEWAY_MODE: 'local_test',
    BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ENABLE: 'false',
    BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE: 'false',
    BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE: 'false',
    BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK: 'false',
    BEVVI_ANALYTICS_GATEWAY_HOST: '127.0.0.1'
  })
  assert.strictEqual(validateModeConfiguration().ok, false)

  setEnv({
    BEVVI_ANALYTICS_GATEWAY_MODE: 'local_test',
    BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ENABLE: 'true',
    BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE: 'true'
  })
  assert.strictEqual(validateModeConfiguration().ok, false)
  assert.strictEqual(validateStartupEnvironment().ok, false)

  setEnv({
    BEVVI_ANALYTICS_GATEWAY_MODE: 'local_test',
    BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ENABLE: 'true',
    BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE: 'false',
    BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE: 'false',
    BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK: 'false',
    BEVVI_ANALYTICS_GATEWAY_HOST: '127.0.0.1',
    BEVVI_ANALYTICS_GATEWAY_ENABLED: 'true'
  })
  assert.strictEqual(validateModeConfiguration().ok, true)
  assert.strictEqual(isLiveComputerMode(), true)
  assert.strictEqual(isOperationAllowedInMode('bevvi_period_comparison'), true)
  assert.strictEqual(isOperationAllowedInMode('bevvi_analysis_data_quality'), false)

  const manifest = buildFreshManifest({ clientId: 'default' })
  writeManifestAtomic(manifest)
  const entry = manifest.entries[0]
  const clientMeta = { clientId: 'default', scopes: ['analytics:submit', 'analytics:read'] }

  const okReq = validateLocalTestSubmission({
    clientId: 'default',
    operation: entry.operation,
    normalizedArgs: entry.arguments,
    idempotencyKey: entry.idempotency_key
  })
  assert.strictEqual(okReq.ok, true)

  const badClient = validateLocalTestSubmission({
    clientId: 'other',
    operation: entry.operation,
    normalizedArgs: entry.arguments,
    idempotencyKey: entry.idempotency_key
  })
  assert.strictEqual(badClient.code, 'local_test_client_forbidden')

  const badTuple = validateLocalTestSubmission({
    clientId: 'default',
    operation: entry.operation,
    normalizedArgs: { ...entry.arguments, start_date: '2026-09-02' },
    idempotencyKey: entry.idempotency_key
  })
  assert.strictEqual(badTuple.code, 'local_test_request_forbidden')

  let submitCount = 0
  __testOnlySetSubmitSpy(() => {
    submitCount += 1
  })

  const first = requestAnalytics(clientMeta, {
    operation: entry.operation,
    arguments: entry.arguments,
    idempotencyKey: entry.idempotency_key
  })
  assert.strictEqual(first.ok, true)
  assert.strictEqual(first.created, true)

  const replay = requestAnalytics(clientMeta, {
    operation: entry.operation,
    arguments: entry.arguments,
    idempotencyKey: entry.idempotency_key
  })
  assert.strictEqual(replay.ok, true)
  assert.strictEqual(replay.created, false)
  assert.strictEqual(replay.jobId, first.jobId)
  assert.strictEqual(submitCount, 0)

  const samplePath = path.join(
    __dirname,
    '..',
    'test-fixtures',
    'analytics-gateway',
    'artifacts',
    'decision_support_v3.sample.json'
  )
  const handler = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
  handler.provenance.as_of = entry.arguments.as_of
  handler.provenance.settled_through = entry.arguments.as_of
  const { hashCanonicalArguments } = require('../lib/analyticsGateway/canonicalJson.cjs')
  const dqArgs = { as_of: '2026-10-02' }
  const jobRecord = {
    jobId: first.jobId,
    operation: 'bevvi_analysis_data_quality',
    arguments: dqArgs,
    requestHash: hashCanonicalArguments(dqArgs)
  }
  handler.provenance.as_of = dqArgs.as_of
  handler.provenance.settled_through = dqArgs.as_of
  const wrapped = wrapHandlerArtifact(jobRecord, handler)
  const finalized = finalizeValidatedJob({
    job: jobRecord,
    rawResult: wrapped,
    assetIdentity: {
      id: 'a1',
      name: `${first.jobId}.json`,
      byte_digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    },
    gatewayMode: 'local_test'
  })
  assert.strictEqual(finalized.ok, true)
  assert.strictEqual(finalized.envelope.gateway_mode, 'local_test')

  const transcriptOnly = finalizeValidatedJob({
    job: jobRecord,
    rawResult: handler,
    assetIdentity: null,
    gatewayMode: 'local_test'
  })
  assert.strictEqual(transcriptOnly.ok, false)

  __testOnlySetSubmitSpy(null)
  console.log('analytics-gateway-local-test-mode-test: OK')
} finally {
  process.env = savedEnv
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
