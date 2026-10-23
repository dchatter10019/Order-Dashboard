#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const {
  shouldRestoreMockGateway,
  blockedRestoreReasonForCheckpoint
} = require('../lib/analyticsGateway/localTestCutover.cjs')
const { writeJobAtomic, readJob } = require('../lib/analyticsGateway/jobStore.cjs')
const {
  deliverArtifactsForJob,
  processJob,
  __testOnlyFlushQueue
} = require('../lib/analyticsGateway/worker.cjs')
const { __testOnlySetSubmitSpy } = require('../lib/analyticsGateway/computerMcpClient.cjs')
const { wrapHandlerArtifact } = require('../lib/analyticsGateway/jobBinding.cjs')
const { hashCanonicalArguments } = require('../lib/analyticsGateway/canonicalJson.cjs')
const {
  reconcileGatewayJob,
  __testOnlySetFetchJobBoundArtifact
} = require('../lib/analyticsGateway/reconcileJob.cjs')

const savedEnv = { ...process.env }
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'q3-recovery-regression-'))
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = path.join(tmpRoot, 'jobs')

function setEnv(overrides) {
  process.env = { ...savedEnv, ...overrides, BEVVI_ANALYTICS_GATEWAY_JOBS_DIR: process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR }
}

try {
  // 1) pipefail preserves failure through tee
  const pipe = spawnSync('bash', ['-lc', 'set -o pipefail; false | tee /dev/null'], { encoding: 'utf8' })
  assert.strictEqual(pipe.status, 1, 'pipefail+tee must preserve nonzero exit')

  const restoreOnFail = shouldRestoreMockGateway({
    runExitCode: pipe.status,
    evidenceValidation: { ok: true, runId: 'run' },
    storeQuiescent: true,
    cutoverGuard: { ok: true }
  })
  assert.strictEqual(restoreOnFail.ok, false)

  // 2) submission_uncertain / checkpoint blocks restoration
  const blocked = blockedRestoreReasonForCheckpoint('terminal_failure')
  assert.ok(blocked)
  const restoreUncertain = shouldRestoreMockGateway({
    runExitCode: 1,
    evidenceValidation: { ok: false, code: 'evidence_missing' },
    storeQuiescent: true,
    cutoverGuard: { ok: true }
  })
  assert.strictEqual(restoreUncertain.ok, false)
  assert.strictEqual(restoreUncertain.reason, 'nonzero_exit')

  const inheritedEnvOnly = shouldRestoreMockGateway({
    runExitCode: 0,
    evidenceValidation: { ok: false, code: 'evidence_missing' },
    storeQuiescent: true,
    cutoverGuard: { ok: true }
  })
  assert.strictEqual(inheritedEnvOnly.ok, false)

  // 3) mock delivery against local_test uncertain job leaves record unchanged, no provider
  setEnv({
    BEVVI_ANALYTICS_GATEWAY_MODE: 'mock',
    BEVVI_ANALYTICS_GATEWAY_ENABLED: 'true'
  })
  let providerCalls = 0
  __testOnlySetSubmitSpy(() => {
    providerCalls += 1
  })
  const uncertainJob = {
    jobId: '00000000-0000-4000-8000-0000000000c1',
    clientId: 'test',
    operation: 'bevvi_planning_forecast',
    arguments: { as_of: '2026-10-02', model: 'planning_blend_v1' },
    pythonArguments: { as_of: '2026-10-02', model: 'planning_blend_v1' },
    requestHash: hashCanonicalArguments({ as_of: '2026-10-02', model: 'planning_blend_v1' }),
    gatewayExecutionMode: 'local_test',
    state: 'submission_uncertain',
    computerTaskSubmitted: true,
    submissionAttemptId: 'attempt-1',
    resultEnvelope: null,
    error: { code: 'submission_uncertain', message: 'timeout' }
  }
  writeJobAtomic(uncertainJob)
  const before = JSON.stringify(readJob(uncertainJob.jobId))
  deliverArtifactsForJob(uncertainJob.jobId, { allowUncertain: true })
  await __testOnlyFlushQueue()
  const after = JSON.stringify(readJob(uncertainJob.jobId))
  assert.strictEqual(before, after)
  assert.strictEqual(providerCalls, 0)

  // 4) missing execution context blocks reconcile without mutation
  setEnv({
    BEVVI_ANALYTICS_GATEWAY_MODE: 'local_test',
    BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ENABLE: 'true',
    BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE: 'false',
    BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE: 'false',
    BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK: 'false'
  })
  const missingCtxJob = {
    ...uncertainJob,
    jobId: '00000000-0000-4000-8000-0000000000c2',
    gatewayExecutionMode: undefined,
    state: 'submission_uncertain'
  }
  writeJobAtomic(missingCtxJob)
  const beforeMissing = JSON.stringify(readJob(missingCtxJob.jobId))
  const reconMissing = await reconcileGatewayJob(missingCtxJob.jobId)
  assert.strictEqual(reconMissing.ok, false)
  assert.strictEqual(reconMissing.code, 'execution_context_missing')
  assert.strictEqual(JSON.stringify(readJob(missingCtxJob.jobId)), beforeMissing)

  // 5) compatible-mode artifact recovery validates wrapper/binding
  const samplePath = path.join(
    __dirname,
    '..',
    'test-fixtures',
    'analytics-gateway',
    'artifacts',
    'decision_support_v3.sample.json'
  )
  const handler = JSON.parse(fs.readFileSync(samplePath, 'utf8'))
  handler.provenance.as_of = '2026-10-02'
  handler.provenance.settled_through = '2026-10-02'
  const liveJob = {
    jobId: '00000000-0000-4000-8000-0000000000c3',
    clientId: 'test',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    pythonArguments: { as_of: '2026-10-02' },
    requestHash: hashCanonicalArguments({ as_of: '2026-10-02' }),
    gatewayExecutionMode: 'local_test',
    state: 'submission_uncertain',
    computerTaskSubmitted: true,
    submissionAttemptId: 'attempt-3',
    resultEnvelope: null
  }
  writeJobAtomic(liveJob)
  const wrapped = wrapHandlerArtifact(liveJob, handler)
  __testOnlySetFetchJobBoundArtifact(async () => ({
    ok: true,
    payload: wrapped,
    assetIdentity: {
      id: 'asset-live',
      name: `${liveJob.jobId}.json`,
      byte_digest: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }
  }))
  const reconOk = await reconcileGatewayJob(liveJob.jobId)
  assert.strictEqual(reconOk.ok, true)
  const healed = readJob(liveJob.jobId)
  assert.strictEqual(healed.state, 'succeeded')
  assert.strictEqual(healed.resultEnvelope.gateway_mode, 'local_test')
  assert.ok(healed.resultEnvelope.provenance.asset_identity)

  // 6) legitimate mock-only queued jobs still succeed via mock process path
  setEnv({
    BEVVI_ANALYTICS_GATEWAY_MODE: 'mock',
    BEVVI_ANALYTICS_GATEWAY_ENABLED: 'true'
  })
  providerCalls = 0
  __testOnlySetSubmitSpy(() => {
    providerCalls += 1
  })
  const mockJob = {
    jobId: '00000000-0000-4000-8000-0000000000c4',
    clientId: 'test',
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    pythonArguments: { as_of: '2026-10-02' },
    requestHash: hashCanonicalArguments({ as_of: '2026-10-02' }),
    gatewayExecutionMode: 'mock',
    state: 'queued',
    computerTaskSubmitted: false,
    submissionAttemptId: null,
    waitingForThreadAdmission: true,
    resultEnvelope: null
  }
  writeJobAtomic(mockJob)
  processJob(mockJob.jobId)
  await __testOnlyFlushQueue()
  const mockDone = readJob(mockJob.jobId)
  assert.strictEqual(mockDone.state, 'succeeded')
  assert.strictEqual(mockDone.resultEnvelope.gateway_mode, 'mock')
  assert.ok(providerCalls >= 1)

  __testOnlySetSubmitSpy(null)
  __testOnlySetFetchJobBoundArtifact(null)
  console.log('analytics-gateway-q3-recovery-regression-test: OK')
} finally {
  process.env = savedEnv
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
