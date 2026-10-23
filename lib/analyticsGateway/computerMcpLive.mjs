import fs from 'fs'
import path from 'path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { COMPUTER_MCP_URL, COMPUTER_THREAD_ID } = require('./constants.cjs')
const { providerException, decodeProviderResult, validateAssetPage } = require('./providerContract.cjs')
const { buildComputerTaskMessage } = require('./taskTemplates.cjs')
const {
  validateStructuredResult,
  paginateAssets,
  verifyDownloadMetadata,
  expectedArtifactBasename
} = require('./resultRetrieval.cjs')
const { resolveJobResultFromAssetsOnly } = require('./artifactDelivery.cjs')
const { validateDecisionSupportV3 } = require('./decisionSupportV3.cjs')
const { buildJobBinding } = require('./jobBinding.cjs')
const {
  createSecureArtifactDownloader,
  isArtifactDownloadPolicyConfigured
} = require('./secureArtifactDownload.mjs')
import { BevviPerplexityOAuthProvider } from './perplexityOAuthProvider.mjs'

const REQUIRED_TOOLS = new Set(['read_thread', 'call_perplexity_computer', 'list_thread_assets', 'create_asset_download'])

let cachedToolNames = null
let downloader = null

function getDownloader() {
  if (!downloader) downloader = createSecureArtifactDownloader()
  return downloader
}

export function __testOnlySetDownloader(instance) {
  downloader = instance
}

export function __testOnlyResetToolCache() {
  cachedToolNames = null
}

async function withComputerClient(fn) {
  const provider = new BevviPerplexityOAuthProvider()
  const url = new URL(COMPUTER_MCP_URL)
  const transport = new StreamableHTTPClientTransport(url, { authProvider: provider })
  const client = new Client({ name: 'bevvi-analytics-gateway', version: '1.1.0' })
  try {
    await client.connect(transport)
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return { ok: false, code: 'needs_auth', message: 'Administrator OAuth required for Computer MCP' }
    }
    throw err
  }
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

async function listComputerToolNames(client) {
  if (cachedToolNames) return cachedToolNames
  const { tools } = await client.listTools()
  cachedToolNames = new Set((tools || []).map((t) => t.name))
  return cachedToolNames
}

async function assertRequiredTools(client) {
  const available = await listComputerToolNames(client)
  for (const name of REQUIRED_TOOLS) {
    if (!available.has(name)) {
      return { ok: false, code: 'upstream_unavailable', message: `Required Computer tool missing: ${name}` }
    }
  }
  return { ok: true }
}

function threadTextIndicatesAuthRequired(text) {
  if (!text || typeof text !== 'string') return false
  try {
    const parsed = JSON.parse(text)
    const status = parsed.thread_status || parsed.web_state?.thread_status || parsed.status
    if (typeof status === 'string' && /\bneeds_auth\b|unauthorized|forbidden/i.test(status)) return true
    return false
  } catch {
    return /\bneeds_auth\b|unauthorized|forbidden/i.test(text.slice(0, 2048))
  }
}

function extractToolText(result) {
  if (!result) return ''
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return JSON.stringify(result.structuredContent)
  }
  const parts = result.content || []
  return parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n')
}

async function listAssetsPage(client, { cursor }) {
  const args = { thread_id: COMPUTER_THREAD_ID }
  if (cursor !== null && cursor !== undefined) args.cursor = cursor
  let result
  try {
    result = await client.callTool({ name: 'list_thread_assets', arguments: args })
  } catch (err) { return providerException(err) }
  const parsed = decodeProviderResult(result)
  return parsed.ok ? validateAssetPage(parsed.value) : parsed
}

async function validateSubmissionPreflight(client) {
  if (!isArtifactDownloadPolicyConfigured()) {
    return {
      ok: false,
      code: 'download_host_policy_unconfigured',
      message: 'Artifact download host allowlist is not configured'
    }
  }
  const readThread = await client.callTool({
    name: 'read_thread',
    arguments: { thread_id: COMPUTER_THREAD_ID }
  })
  if (!readThread || readThread.isError) {
    return { ok: false, code: 'needs_auth', message: 'read_thread failed for fixed thread' }
  }
  const text = extractToolText(readThread)
  if (threadTextIndicatesAuthRequired(text)) {
    return { ok: false, code: 'needs_auth', message: 'Computer thread is not readable' }
  }
  return { ok: true }
}

function maybeRetainLocalTestArtifact(jobId, rawText) {
  const dir = process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ARTIFACT_DIR
  if (!dir || !jobId || !rawText) return
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, `${jobId}.json`)
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, rawText.endsWith('\n') ? rawText : `${rawText}\n`, { mode: 0o600 })
  }
}

async function downloadAssetPayload(client, selectedAsset, jobId) {
  let download
  try { download = await client.callTool({
    name: 'create_asset_download',
    arguments: {
      thread_id: COMPUTER_THREAD_ID,
      asset_id: selectedAsset.asset_id || selectedAsset.id
    }
  }) } catch (err) { return providerException(err) }
  const decoded = decodeProviderResult(download)
  if (!decoded.ok) return decoded
  const meta = decoded.value
  const metaCheck = verifyDownloadMetadata(selectedAsset, meta)
  if (!metaCheck.ok) return metaCheck
  const url = meta?.url || meta?.download_url
  if (!url || typeof url !== 'string') {
    return { ok: false, code: 'missing_download_url', message: 'Download URL missing from metadata' }
  }
  const fetched = await getDownloader().downloadJson(url)
  if (!fetched.ok) return fetched
  maybeRetainLocalTestArtifact(jobId, fetched.rawText)
  return {
    ok: true,
    payload: fetched.payload,
    byteDigest: fetched.byteDigest,
    contentType: fetched.contentType
  }
}

async function tryFetchJobAsset(client, jobId) {
  const selected = await paginateAssets((pageArgs) => listAssetsPage(client, pageArgs), jobId)
  if (!selected) return null
  if (selected.ok === false) return { ...selected, artifactDeliveryError: true }
  if (selected.error) return selected
  const asset = selected.asset
  const downloaded = await downloadAssetPayload(client, asset, jobId)
  if (!downloaded?.ok) return downloaded ? { ...downloaded, artifactDeliveryError: true } : downloaded
  return {
    payload: downloaded.payload,
    assetIdentity: {
      id: asset.asset_id || asset.id || null,
      entry_id: asset.entry_id || null,
      name: asset.filename || asset.name || expectedArtifactBasename(jobId),
      version: asset.version ?? asset.revision ?? asset.content_hash ?? null,
      updated_at: asset.updated_at ?? asset.created_at ?? null,
      mime_type: asset.mime_type || null,
      is_primary_asset: asset.is_primary_asset ?? null,
      byte_digest: downloaded.byteDigest || null
    }
  }
}

function assetFetcher(client) {
  return (jobId) => tryFetchJobAsset(client, jobId)
}

export async function fetchJobBoundArtifact(jobId) {
  return withComputerClient(async (client) => {
    const toolsOk = await assertRequiredTools(client)
    if (!toolsOk.ok) return toolsOk
    const assetPayload = await tryFetchJobAsset(client, jobId)
    if (!assetPayload) {
      return { ok: false, code: 'missing_result', message: 'No job-bound asset found' }
    }
    if (assetPayload.error === 'ambiguous_asset') {
      return { ok: false, code: 'ambiguous_asset', message: 'Multiple assets matched job id' }
    }
    if (assetPayload.ok === false) {
      return assetPayload
    }
    return {
      ok: true,
      payload: assetPayload.payload,
      assetIdentity: assetPayload.assetIdentity
    }
  })
}

export async function executeLiveJobOnClient(client, { operation, arguments: args, jobId, jobRecord, reconcileOnly = false }) {
  const toolsOk = await assertRequiredTools(client)
  if (!toolsOk.ok) return toolsOk

  if (reconcileOnly) {
    const assetPayload = await tryFetchJobAsset(client, jobId)
    if (assetPayload?.ok === false) return assetPayload
    if (assetPayload?.error === 'ambiguous_asset') {
      return { ok: false, code: 'ambiguous_asset', message: 'Multiple assets matched job id' }
    }
    if (!assetPayload?.payload) {
      return { ok: false, code: 'missing_result', message: 'No job-bound asset found during reconcile' }
    }
    const validation = validateStructuredResult({
      job: jobRecord,
      payload: assetPayload.payload,
      assetIdentity: assetPayload.assetIdentity,
      requireBinding: true
    })
    if (!validation.ok) return validation
    const v3 = validateDecisionSupportV3(validation.normalized, jobRecord, {
      wrappedHandler: validation.wrapped
    })
    if (!v3.ok) return v3
    return {
      ok: true,
      mode: 'live',
      threadId: COMPUTER_THREAD_ID,
      result: assetPayload.payload,
      assetIdentity: assetPayload.assetIdentity,
      reconciled: true
    }
  }

  const preflight = await validateSubmissionPreflight(client)
  if (!preflight.ok) return preflight

  const pythonArgs = jobRecord.pythonArguments || args
  const binding = buildJobBinding(jobRecord)
  const message = buildComputerTaskMessage(operation, pythonArgs, jobId, binding)
  const taskResult = await client.callTool({
    name: 'call_perplexity_computer',
    arguments: { message, thread_id: COMPUTER_THREAD_ID }
  })
  if (!taskResult) {
    return { ok: false, code: 'upstream_unavailable', message: 'call_perplexity_computer failed' }
  }

  const resolved = await resolveJobResultFromAssetsOnly({
    taskResult: { ...taskResult, text: extractToolText(taskResult) },
    fetchAssetForJob: assetFetcher(client),
    jobId
  })
  if (!resolved.ok) {
    return { ...resolved, computerTaskSubmitted: true }
  }

  const validation = validateStructuredResult({
    job: jobRecord,
    payload: resolved.result,
    assetIdentity: resolved.assetIdentity,
    requireBinding: true
  })
  if (!validation.ok) return validation
  const v3 = validateDecisionSupportV3(validation.normalized, jobRecord, {
    wrappedHandler: validation.wrapped
  })
  if (!v3.ok) return v3

  return {
    ok: true,
    mode: 'live',
    threadId: COMPUTER_THREAD_ID,
    result: resolved.result,
    assetIdentity: resolved.assetIdentity,
    computerTaskSubmitted: true
  }
}

export async function runLiveComputerAnalyticsJob(params) {
  return withComputerClient((client) => executeLiveJobOnClient(client, params))
}

function parseGuardHintsFromThreadText(text) {
  const hints = {}
  const gateMatch = text.match(/"gate_status"\s*:\s*"([^"]+)"/i)
  if (gateMatch) hints.gate_status = gateMatch[1]
  const xgbMatch = text.match(/"use_xgboost"\s*:\s*(true|false)/i)
  if (xgbMatch) hints.use_xgboost = xgbMatch[1] === 'true'
  return hints
}

export async function probeReadOnlyThreadGuards() {
  const wrapped = await withComputerClient(async (client) => {
    const readThread = await client.callTool({
      name: 'read_thread',
      arguments: { thread_id: COMPUTER_THREAD_ID }
    })
    if (!readThread || readThread.isError) {
      return { ok: false, code: 'needs_auth', message: 'read_thread failed for fixed thread' }
    }
    const text = extractToolText(readThread)
    if (threadTextIndicatesAuthRequired(text)) {
      return { ok: false, code: 'needs_auth', message: 'Computer thread is not readable' }
    }
    return {
      ok: true,
      threadId: COMPUTER_THREAD_ID,
      hints: parseGuardHintsFromThreadText(text),
      note: 'Read-only thread probe; does not refresh cache or run handlers'
    }
  })
  if (wrapped?.ok === false && wrapped.code) return wrapped
  return wrapped
}

export async function verifyComputerConnectionReadOnly() {
  return withComputerClient(async (client) => {
    const tools = await listComputerToolNames(client)
    for (const name of REQUIRED_TOOLS) {
      if (!tools.has(name)) {
        return { ok: false, code: 'upstream_unavailable', message: `Missing tool ${name}` }
      }
    }
    return {
      ok: true,
      tools: [...tools].sort(),
      threadId: COMPUTER_THREAD_ID
    }
  })
}
