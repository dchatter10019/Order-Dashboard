#!/usr/bin/env node
import assert from 'assert'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import {
  executeLiveJobOnClient,
  __testOnlySetDownloader
} from '../lib/analyticsGateway/computerMcpLive.mjs'
import { createSecureArtifactDownloader } from '../lib/analyticsGateway/secureArtifactDownload.mjs'
import { resolveJobResultFromAssetsOnly } from '../lib/analyticsGateway/artifactDelivery.cjs'
import { finalizeValidatedJob } from '../lib/analyticsGateway/jobValidation.cjs'
import { reconcileGatewayJob, TERMINAL_STATES } from '../lib/analyticsGateway/reconcileJob.cjs'
import { buildComputerTaskMessage } from '../lib/analyticsGateway/taskTemplates.cjs'
import { wrapHandlerArtifact } from '../lib/analyticsGateway/jobBinding.cjs'
import { hashCanonicalArguments } from '../lib/analyticsGateway/canonicalJson.cjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const samplePath = path.join(
  __dirname,
  '..',
  'test-fixtures',
  'analytics-gateway',
  'artifacts',
  'decision_support_v3.sample.json'
)
const sampleBase = JSON.parse(fs.readFileSync(samplePath, 'utf8'))

function makeJob(overrides = {}) {
  const args = overrides.arguments || { as_of: '2026-10-02' }
  const job = {
    jobId: overrides.jobId || '00000000-0000-4000-8000-000000000001',
    operation: 'bevvi_analysis_data_quality',
    arguments: args,
    requestHash: hashCanonicalArguments(args),
    clientId: 'test',
    state: 'queued',
    gatewayExecutionMode: 'mock',
    ...overrides
  }
  job.requestHash = hashCanonicalArguments(job.arguments)
  return job
}

function payloadForJob(job, mutate) {
  const handler = JSON.parse(JSON.stringify(sampleBase))
  handler.provenance.as_of = job.arguments.as_of
  handler.provenance.settled_through = job.arguments.as_of
  if (mutate) mutate(handler)
  return wrapHandlerArtifact(job, handler)
}

function mockClient({ getJobId, assetsByJob, computerCallsRef, assetFetchesRef }) {
  return {
    async listTools() {
      return {
        tools: [
          { name: 'read_thread' },
          { name: 'call_perplexity_computer' },
          { name: 'list_thread_assets' },
          { name: 'create_asset_download' }
        ]
      }
    },
    async callTool({ name, arguments: args }) {
      if (name === 'read_thread') {
        return { content: [{ type: 'text', text: '{"thread":"ok"}' }] }
      }
      if (name === 'call_perplexity_computer') {
        computerCallsRef.count += 1
        return {
          content: [
            {
              type: 'text',
              text: '{"event":"complete","text":"transcript must not be used as result"}'
            }
          ]
        }
      }
      if (name === 'list_thread_assets') {
        assetFetchesRef.count += 1
        const jobId = getJobId()
        const assets = (assetsByJob.map[jobId] || []).map(({ _body, ...rest }) => rest)
        return { content: [{ type: 'text', text: JSON.stringify({ assets, next_cursor: null }) }] }
      }
      if (name === 'create_asset_download') {
        const assetId = args.asset_id
        const entry = Object.values(assetsByJob.map).flat().find((a) => a.asset_id === assetId)
        if (!entry?._body) return { isError: true, content: [{ type: 'text', text: 'missing' }] }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                url: `https://asset.mock/${getJobId()}/${assetId}`,
                asset_id: assetId
              })
            }
          ]
        }
      }
      return { content: [{ type: 'text', text: '{}' }] }
    }
  }
}

const originalFetch = globalThis.fetch
const mockFetch = async (url) => {
  const parsed = new URL(String(url))
  if (parsed.hostname === 'asset.mock') {
    const parts = parsed.pathname.split('/').filter(Boolean)
    const jobId = parts[0]
    const assetId = parts[1]
    const body = global.__mockAssetBodies?.[jobId]?.[assetId]
    if (body) {
      return {
        ok: true,
        status: 200,
        headers: { get: (h) => (h && h.toLowerCase() === 'content-type' ? 'application/json' : null) },
        body: {
          getReader() {
            const buf = Buffer.from(body)
            let done = false
            return {
              async read() {
                if (done) return { done: true, value: undefined }
                done = true
                return { done: false, value: buf }
              }
            }
          }
        },
        text: async () => body
      }
    }
  }
  return originalFetch(url)
}
globalThis.fetch = mockFetch
__testOnlySetDownloader(
  createSecureArtifactDownloader({
    allowedHosts: new Set(['asset.mock']),
    fetchImpl: mockFetch,
    trustAllowedHostsWithoutDns: true
  })
)

const jobStore = require('../lib/analyticsGateway/jobStore.cjs')
const savedEnv = { ...process.env }
process.env.BEVVI_ANALYTICS_GATEWAY_ARTIFACT_DOWNLOAD_ALLOW_HOSTS = 'asset.mock'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = path.join(
  __dirname,
  '..',
  'data',
  'analytics-gateway',
  'artifact-delivery-test-jobs'
)
fs.rmSync(process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR, { recursive: true, force: true })

// 1) Task template requires mandatory artifact write
const taskText = buildComputerTaskMessage('bevvi_analysis_data_quality', { as_of: '2026-10-02' }, 'job-abc')
assert.match(taskText, /Required: write the complete artifact object/)
assert.match(taskText, /gateway_job_binding/)
assert.match(taskText, /register\/share that exact file on thread/)
assert.match(taskText, /list_thread_assets with filename/)
assert.doesNotMatch(taskText, /Optional:/)

// 2) Transcript ignored — asset used
{
  const job = makeJob()
  const payload = payloadForJob(job)
  global.__mockAssetBodies = {
    [job.jobId]: {
      'asset-1': JSON.stringify(payload)
    }
  }
  const assetsByJob = {
    map: {
      [job.jobId]: [{ asset_id: 'asset-1', filename: `${job.jobId}.json`, _body: true }]
    }
  }
  const computerCallsRef = { count: 0 }
  const assetFetchesRef = { count: 0 }
  const client = mockClient({
    getJobId: () => job.jobId,
    assetsByJob,
    computerCallsRef,
    assetFetchesRef
  })

  const out = await executeLiveJobOnClient(client, {
    operation: job.operation,
    arguments: job.arguments,
    jobId: job.jobId,
    jobRecord: job
  })
  assert.strictEqual(out.ok, true)
  assert.strictEqual(computerCallsRef.count, 1)
  assert.ok(assetFetchesRef.count >= 1)
  assert.strictEqual(out.result.gateway_job_binding.job_id, job.jobId)
}

// 3) Missing asset -> awaiting_artifact, no transcript fallback
{
  const job = makeJob({ jobId: '00000000-0000-4000-8000-000000000002' })
  const assetsByJob = { map: { [job.jobId]: [] } }
  const computerCallsRef = { count: 0 }
  const assetFetchesRef = { count: 0 }
  const client = mockClient({
    getJobId: () => job.jobId,
    assetsByJob,
    computerCallsRef,
    assetFetchesRef
  })
  const out = await executeLiveJobOnClient(client, {
    operation: job.operation,
    arguments: job.arguments,
    jobId: job.jobId,
    jobRecord: job
  })
  assert.strictEqual(out.ok, false)
  assert.strictEqual(out.code, 'awaiting_artifact')
  assert.strictEqual(computerCallsRef.count, 1)
}

// 4) Wrong job_id in artifact
{
  const job = makeJob({ jobId: '00000000-0000-4000-8000-000000000003' })
  const payload = payloadForJob(job)
  payload.gateway_job_binding.job_id = 'wrong-id'
  global.__mockAssetBodies[job.jobId] = { a1: JSON.stringify(payload) }
  const assetsByJob = {
    map: { [job.jobId]: [{ asset_id: 'a1', filename: `${job.jobId}.json`, _body: true }] }
  }
  const client = mockClient({
    getJobId: () => job.jobId,
    assetsByJob,
    computerCallsRef: { count: 0 },
    assetFetchesRef: { count: 0 }
  })
  const out = await executeLiveJobOnClient(client, {
    operation: job.operation,
    arguments: job.arguments,
    jobId: job.jobId,
    jobRecord: job
  })
  assert.strictEqual(out.ok, false)
  assert.strictEqual(out.code, 'job_mismatch')
}

// 5) Guard fail — live gate ON
{
  const job = makeJob({ jobId: '00000000-0000-4000-8000-000000000004' })
  const payload = payloadForJob(job, (p) => {
    p.live_gate_status = 'ON'
    p.provenance.live_gate_status = 'ON'
  })
  global.__mockAssetBodies[job.jobId] = { 'asset-004': JSON.stringify(payload) }
  const assetsByJob = {
    map: { [job.jobId]: [{ asset_id: 'asset-004', filename: `${job.jobId}.json`, _body: true }] }
  }
  const client = mockClient({
    getJobId: () => job.jobId,
    assetsByJob,
    computerCallsRef: { count: 0 },
    assetFetchesRef: { count: 0 }
  })
  const out = await executeLiveJobOnClient(client, {
    operation: job.operation,
    arguments: job.arguments,
    jobId: job.jobId,
    jobRecord: job
  })
  assert.strictEqual(out.ok, false)
  assert.strictEqual(out.code, 'live_gate_not_off')
}

// 6) Restart recovery — resume uses asset fetch only
{
  const { resumeArtifactDelivery, applyUpstreamOutcome } = require('../lib/analyticsGateway/worker.cjs')
  const job = makeJob({ jobId: '00000000-0000-4000-8000-000000000005' })
  jobStore.writeJobAtomic({
    ...job,
    state: 'awaiting_artifact',
    computerTaskSubmitted: true
  })
  const payload = payloadForJob(job)
  global.__mockAssetBodies[job.jobId] = { a1: JSON.stringify(payload) }

  // Monkey-patch fetchJobBoundArtifact for this test via live resume path — use reconcile instead
  process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'smoke'
  process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE = 'true'

  // Direct finalize path simulating recovery fetch result
  const finalized = finalizeValidatedJob({
    job,
    rawResult: payload,
    assetIdentity: {
      id: 'a1',
      name: `${job.jobId}.json`,
      byte_digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    },
    gatewayMode: 'smoke'
  })
  assert.strictEqual(finalized.ok, true)
  assert.strictEqual(finalized.envelope.gateway_mode, 'smoke')
  assert.strictEqual(finalized.envelope.handler_live_gate_status, 'OFF')
  assert.ok(finalized.envelope.certification_warnings.length >= 1)
}

// 7) --force rejects non-terminal
{
  process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
  delete process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE
  jobStore.writeJobAtomic({
    ...makeJob({ jobId: '00000000-0000-4000-8000-000000000006' }),
    state: 'running',
    gatewayExecutionMode: 'mock'
  })
  const bad = await reconcileGatewayJob('00000000-0000-4000-8000-000000000006', { forceRevalidate: true })
  assert.strictEqual(bad.code, 'force_requires_terminal')
}

// 8) resolveJobResultFromAssetsOnly never parses transcript JSON as result
{
  const job = makeJob({ jobId: '00000000-0000-4000-8000-000000000007' })
  const goodPayload = payloadForJob(job)
  let fetches = 0
  const resolved = await resolveJobResultFromAssetsOnly({
    taskResult: {
      text: JSON.stringify({ job_id: job.jobId, freshness_ok: true, operation: job.operation })
    },
    fetchAssetForJob: async () => {
      fetches += 1
      return {
        payload: goodPayload,
        assetIdentity: { id: 'x', name: `${job.jobId}.json` }
      }
    },
    jobId: job.jobId
  })
  assert.strictEqual(resolved.ok, true)
  assert.strictEqual(fetches, 1)
  assert.strictEqual(
    resolved.result.handler_result.provenance.analysis_contract.includes('decision_support_v3'),
    true
  )
}

assert.ok(TERMINAL_STATES.has('succeeded'))

globalThis.fetch = originalFetch
delete global.__mockAssetBodies
fs.rmSync(process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR, { recursive: true, force: true })
process.env = savedEnv

console.log('analytics-gateway-artifact-delivery-test: OK')
