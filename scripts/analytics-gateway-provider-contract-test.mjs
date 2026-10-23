#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { captureProviderEvidence, readOnlyTransportOptions, TARGET_JOB_ID, TARGET_ASSET_ID } from '../lib/analyticsGateway/providerEvidenceCapture.mjs'
import { executeLiveJobOnClient, __testOnlyResetToolCache } from '../lib/analyticsGateway/computerMcpLive.mjs'
const require = createRequire(import.meta.url)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defs = JSON.parse(fs.readFileSync(path.join(root, 'test-fixtures/analytics-gateway/Computer-Provider-Tool-Definitions.json')))
const { COMPUTER_THREAD_ID, COMPUTER_MCP_URL } = require('../lib/analyticsGateway/constants.cjs')
const { paginateAssets, MAX_ASSET_PAGES } = require('../lib/analyticsGateway/resultRetrieval.cjs')
const { providerFailure } = require('../lib/analyticsGateway/providerContract.cjs')
const { resolveJobResultFromAssetsOnly } = require('../lib/analyticsGateway/artifactDelivery.cjs')
globalThis.fetch = async () => { throw new Error('Network prohibited in offline tests') }
const id = '11111111-1111-4111-8111-111111111111'
const match = { asset_id: 'synthetic-match', filename: `${id}.json` }
const reply = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] })
const tests = []
async function test(name, fn) { await fn(); tests.push(name) }
await test('short and empty pages follow cursor; no offset or limit', async () => {
  let i = 0
  const pages = [{ assets: [], next_cursor: 'a' }, { assets: [match], next_cursor: 'b' }, { assets: [], next_cursor: null }]
  const r = await paginateAssets(async args => {
    assert.deepEqual(Object.keys(args), ['cursor'])
    assert.equal(args.cursor, [null, 'a', 'b'][i])
    return pages[i++]
  }, id)
  assert.equal(i, 3); assert.equal(r.asset.asset_id, match.asset_id)
})
await test('explicit terminal stops even with full page', async () => {
  let calls = 0
  const r = await paginateAssets(async () => {
    calls++
    return { assets: Array.from({ length: 100 }, (_, i) => ({ asset_id: `a${i}`, filename: 'other.json' })), next_cursor: null }
  }, id)
  assert.equal(r, null); assert.equal(calls, 1)
})
await test('missing, malformed and aliased continuation rejected', async () => {
  for (const value of [null, { assets: [] }, { assets: [], cursor: null }, { assets: [], next_cursor: 1 },
    { assets: [], next_cursor: '' }, { assets: [null], next_cursor: null }, { items: [], next_cursor: null }]) {
    assert.equal((await paginateAssets(async () => value, id)).code, 'invalid_provider_response')
  }
})
await test('repeated cursor and repeated asset pages fail closed', async () => {
  let calls = 0
  const r = await paginateAssets(async () => { calls++; return { assets: [], next_cursor: 'private-cursor' } }, id)
  assert.equal(r.code, 'listing_incomplete'); assert.equal(calls, 2)
  assert.ok(!JSON.stringify(r).includes('private-cursor'))
  let page = 0
  const repeated = await paginateAssets(async () => ({ assets: [match], next_cursor: `page${page++}` }), id)
  assert.equal(repeated.reason, 'repeated_asset_page')
})
await test('cap exhaustion does not accept early match', async () => {
  let calls = 0
  const r = await paginateAssets(async () => ({ assets: calls === 0 ? [match] : [], next_cursor: `p${calls++}` }), id)
  assert.equal(calls, MAX_ASSET_PAGES); assert.equal(r.code, 'listing_incomplete')
})
await test('distinct duplicate matches remain ambiguous', async () => {
  const r = await paginateAssets(async () => ({ assets: [match, { ...match, asset_id: 'other-version' }], next_cursor: null }), id)
  assert.equal(r.error, 'ambiguous_asset')
})
await test('actual adapter sends schema-valid keys and retains rejection', async () => {
  const calls = []
  const client = {
    listTools: async () => ({ tools: [...defs, { name: 'read_thread' }, { name: 'call_perplexity_computer' }] }),
    callTool: async req => {
      calls.push(req)
      assert.equal(req.name, 'list_thread_assets')
      assert.deepEqual(Object.keys(req.arguments), ['thread_id'])
      assert.equal(req.arguments.thread_id, COMPUTER_THREAD_ID)
      return { isError: true, content: [{ type: 'text', text: 'sensitive error not to be persisted' }] }
    }
  }
  __testOnlyResetToolCache()
  const r = await executeLiveJobOnClient(client, { jobId: id, jobRecord: {}, reconcileOnly: true })
  assert.equal(calls.length, 1); assert.equal(r.code, 'provider_request_failed')
  assert.ok(!JSON.stringify(r).includes('sensitive'))
})
await test('delivery preserves provider errors instead of awaiting artifact', async () => {
  const failure = providerFailure('listing_incomplete')
  const result = await resolveJobResultFromAssetsOnly({ taskResult: {}, fetchAssetForJob: async () => failure, jobId: id })
  assert.deepEqual(result, failure)
  const transport = await paginateAssets(async () => { throw new Error('raw private transport message') }, id)
  assert.equal(transport.code, 'provider_transport_error')
  assert.ok(!JSON.stringify(transport).includes('raw private'))
})
await test('actual adapter forwards only opaque cursor and preserves download metadata error', async () => {
  const requests = []
  const client = {
    listTools: async () => ({ tools: [...defs, { name: 'read_thread' }, { name: 'call_perplexity_computer' }] }),
    callTool: async req => {
      requests.push(req)
      if (req.name === 'list_thread_assets') {
        if (!req.arguments.cursor) return reply({ assets: [], next_cursor: 'opaque-next' })
        assert.deepEqual(req.arguments, { thread_id: COMPUTER_THREAD_ID, cursor: 'opaque-next' })
        return reply({ assets: [match], next_cursor: null })
      }
      assert.equal(req.name, 'create_asset_download')
      assert.deepEqual(req.arguments, { thread_id: COMPUTER_THREAD_ID, asset_id: match.asset_id })
      return { isError: true }
    }
  }
  __testOnlyResetToolCache()
  const result = await executeLiveJobOnClient(client, { jobId: id, jobRecord: {}, reconcileOnly: true })
  assert.equal(result.code, 'provider_request_failed')
  assert.equal(requests.length, 3)
})

const target = { asset_id: TARGET_ASSET_ID, entry_id: 'synthetic-entry', filename: `${TARGET_JOB_ID}.json`,
  mime_type: 'application/json', is_primary_asset: true, created_at: 1791140400 }
function captureClient(pages, options = {}) {
  const calls = []
  let i = 0
  return {
    calls,
    listTools: async () => ({ tools: defs }),
    callTool: async req => {
      calls.push(req)
      assert.equal(req.arguments.thread_id, COMPUTER_THREAD_ID)
      if (req.name === 'list_thread_assets') {
        assert.ok(Object.keys(req.arguments).every(k => ['thread_id', 'cursor'].includes(k)))
        if (options.error) return { isError: true }
        return reply(typeof pages === 'function' ? pages(i++) : pages[i++])
      }
      assert.equal(req.name, 'create_asset_download')
      assert.equal(req.arguments.asset_id, TARGET_ASSET_ID)
      return reply(options.meta || { asset_id: TARGET_ASSET_ID,
        url: 'https://asset.example.invalid/private-path?signature=private-secret', expires_in_seconds: null })
    }
  }
}
await test('capture redacts cursors and unrelated assets; binds target; never downloads body', async () => {
  const client = captureClient([
    { assets: [{ asset_id: 'unrelated-id', filename: 'private-customer-name' }], next_cursor: 'private-account-cursor' },
    { assets: [target], next_cursor: null }
  ])
  const capture = await captureProviderEvidence(client)
  assert.equal(capture.summary.status, 'READ_ONLY_CAPTURE_COMPLETE')
  assert.equal(capture.summary.download_metadata_calls, 1)
  const text = JSON.stringify(capture)
  for (const secret of ['private-account-cursor', 'unrelated-id', 'private-customer-name', 'private-path', 'private-secret']) {
    assert.ok(!text.includes(secret), secret)
  }
  assert.ok(text.includes(TARGET_ASSET_ID))
  assert.equal(capture.summary.analytical_submissions, 0)
  assert.equal(capture.summary.artifact_body_fetches, 0)
})
await test('capture blocks metadata download for absent, ambiguous or mismatched target', async () => {
  for (const assets of [[], [target, { ...target, asset_id: 'another-id' }],
    [{ ...target, filename: 'wrong.json' }], [{ ...target, entry_id: null }]]) {
    const client = captureClient([{ assets, next_cursor: null }])
    const capture = await captureProviderEvidence(client)
    assert.equal(capture.summary.status, 'CHECKPOINT')
    assert.ok(client.calls.every(c => c.name === 'list_thread_assets'))
  }
})
await test('capture does not overwrite pagination failure or accept incomplete listing', async () => {
  for (const client of [
    captureClient([], { error: true }),
    captureClient(() => ({ assets: [], next_cursor: 'repeated' })),
    captureClient(i => ({ assets: i === 0 ? [target] : [], next_cursor: `p${i}` })),
    captureClient([{ assets: [] }])
  ]) {
    const capture = await captureProviderEvidence(client)
    assert.equal(capture.summary.status, 'CHECKPOINT')
    assert.equal(capture.summary.download_metadata_calls, 0)
    assert.ok(capture.summary.asset_list_calls <= 10)
  }
})
await test('metadata identity, HTTPS and userinfo rejected; errors sanitized', async () => {
  for (const meta of [
    { asset_id: 'wrong', url: 'https://asset.example.invalid', expires_in_seconds: null },
    { asset_id: TARGET_ASSET_ID, url: 'http://asset.example.invalid', expires_in_seconds: null },
    { asset_id: TARGET_ASSET_ID, url: 'https://user:private-secret@asset.example.invalid', expires_in_seconds: null }
  ]) {
    const capture = await captureProviderEvidence(captureClient([{ assets: [target], next_cursor: null }], { meta }))
    assert.equal(capture.summary.checkpoint, 'download_metadata_invalid')
    assert.ok(!JSON.stringify(capture).includes('private-secret'))
  }
})
await test('discovery is bounded and fails closed', async () => {
  let count = 0
  const capture = await captureProviderEvidence({
    listTools: async () => ({ tools: [], nextCursor: `p${count++}` }),
    callTool: async () => { throw new Error('must never call') }
  })
  assert.equal(count, 5); assert.equal(capture.summary.checkpoint, 'metadata_listing_incomplete')
})
await test('read-only transport has no OAuth callbacks and blocks expiry, redirect and other endpoints', async () => {
  const snapshot = { tokens: { access_token: 'synthetic-access', expires_at: Date.now() + 60000, refresh_token: 'never-used' } }
  const before = JSON.stringify(snapshot)
  let fetches = 0
  const opts = readOnlyTransportOptions(snapshot, async (url, init) => {
    fetches++
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers.get('Authorization'), 'Bearer synthetic-access')
    return { status: 200 }
  })
  assert.equal(opts.authProvider, undefined)
  await opts.fetch(COMPUTER_MCP_URL)
  await assert.rejects(opts.fetch('https://unapproved.example.invalid'), e => e.checkpointCode === 'provider_endpoint_out_of_scope')
  assert.equal(fetches, 1); assert.equal(JSON.stringify(snapshot), before)
  assert.throws(() => readOnlyTransportOptions({ tokens: { ...snapshot.tokens, expires_at: 0 } }), e => e.checkpointCode === 'needs_auth')
  const unauthorized = readOnlyTransportOptions(snapshot, async () => ({ status: 401 }))
  await assert.rejects(unauthorized.fetch(COMPUTER_MCP_URL), e => e.checkpointCode === 'needs_auth')
})
await test('provider failure retains unresolved job admission; no resubmission', async () => {
  const temp = fs.mkdtempSync(path.join(root, '.provider-contract-test-'))
  const old = process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR
  process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = temp
  process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
  process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE = 'false'
  process.env.BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE = 'false'
  try {
    const store = require('../lib/analyticsGateway/jobStore.cjs')
    const admission = require('../lib/analyticsGateway/jobAdmission.cjs')
    const worker = require('../lib/analyticsGateway/worker.cjs')
    const reconcile = require('../lib/analyticsGateway/reconcileJob.cjs')
    const job = store.createJob({ clientId: 'synthetic', operation: 'bevvi_analysis_data_quality', arguments: { as_of: '2026-10-02' } }).job
    store.updateJob(job.jobId, { computerTaskSubmitted: true })
    assert.equal(admission.acquireThreadAdmission(job.jobId, 'synthetic-owner').ok, true)
    worker.applyUpstreamOutcome(job.jobId, providerFailure('provider_request_failed'), 'synthetic-owner')
    assert.equal(store.readJob(job.jobId).state, 'delivery_failed')
    assert.equal(admission.readLock().jobId, job.jobId)
    worker.applyUpstreamOutcome(job.jobId, { ok: false, code: 'download_host_not_allowed', artifactDeliveryError: true }, 'synthetic-owner')
    assert.equal(store.readJob(job.jobId).state, 'delivery_failed')
    assert.equal(admission.readLock().jobId, job.jobId)
    await reconcile.applyArtifactValidation(job.jobId, providerFailure('listing_incomplete'), [])
    assert.equal(store.readJob(job.jobId).state, 'delivery_failed')
    assert.equal(admission.readLock().jobId, job.jobId)
    await reconcile.applyArtifactValidation(job.jobId, providerFailure('needs_auth'), [])
    assert.equal(store.readJob(job.jobId).state, 'needs_auth')
    assert.equal(admission.readLock().jobId, job.jobId)
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
    if (old === undefined) delete process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR
    else process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = old
  }
})
console.log(`analytics-gateway-provider-contract-test: OK (${tests.length} checks; no network)`)
