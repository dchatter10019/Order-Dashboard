import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { COMPUTER_MCP_URL, COMPUTER_THREAD_ID } = require('./constants.cjs')
const { decodeProviderResult, validateAssetPage, providerException } = require('./providerContract.cjs')
export const TARGET_JOB_ID = '88622d06-3505-462a-838d-b945d052b7f2'
export const TARGET_ASSET_ID = 'd7419c4c-3027-4e8d-9d6c-dd45cc90c5e0'
const ALLOWED = new Set(['list_thread_assets', 'create_asset_download'])
const hash = value => crypto.createHash('sha256').update(value).digest('hex')
const cursorEvidence = value => value === null ? null : { type: 'string', redacted: true, sha256: hash(value) }
function checkpoint(code) { throw Object.assign(new Error(code), { checkpointCode: code }) }
function safeTarget(asset) {
  if (typeof asset.entry_id !== 'string' || !asset.entry_id ||
      asset.mime_type !== 'application/json' ||
      !(asset.is_primary_asset === null || typeof asset.is_primary_asset === 'boolean')) checkpoint('target_identity_incomplete')
  return {
    asset_id: asset.asset_id, entry_id: asset.entry_id, filename: asset.filename,
    mime_type: asset.mime_type, is_primary_asset: asset.is_primary_asset,
    created_at: typeof asset.created_at === 'number' ? asset.created_at : null
  }
}

// Existing access only: no authProvider, refresh, registration, redirect or credential writes.
export function readOnlyTransportOptions(store, baseFetch = globalThis.fetch, now = Date.now()) {
  const token = store?.tokens?.access_token
  const expires = store?.tokens?.expires_at
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token) ||
      !Number.isFinite(expires) || expires <= now) checkpoint('needs_auth')
  return {
    fetch: async (input, init = {}) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url)
      const permitted = new URL(COMPUTER_MCP_URL)
      if (url.origin !== permitted.origin || url.pathname !== permitted.pathname ||
          url.username || url.password || url.search || url.hash) checkpoint('provider_endpoint_out_of_scope')
      const headers = new Headers(init.headers || (typeof input === 'object' ? input.headers : undefined))
      headers.set('Authorization', `Bearer ${token}`)
      const response = await baseFetch(input, { ...init, headers, redirect: 'error', credentials: 'omit' })
      if (response.status === 401 || response.status === 403) checkpoint('needs_auth')
      return response
    }
  }
}

export async function captureProviderEvidence(client) {
  const summary = {
    captured_at_utc: new Date().toISOString(), endpoint: COMPUTER_MCP_URL,
    thread_id: COMPUTER_THREAD_ID, analytical_submissions: 0, artifact_body_fetches: 0,
    tool_list_calls: 0, asset_list_calls: 0, download_metadata_calls: 0,
    status: 'INCOMPLETE', checkpoint: null
  }
  const definitions = []
  const pages = []
  let host = null
  let matched = null
  const docs = () => ({
    'COMPUTER_MCP_TOOL_DEFINITIONS.json': definitions,
    'COMPUTER_MCP_PAGINATION_CAPTURE.json': { pages, matched_target: matched, terminal_observed: summary.terminal_observed === true },
    'COMPUTER_MCP_ARTIFACT_HOST_CANDIDATES.json': { candidates: host ? [host] : [], approval: 'OBSERVED_NOT_APPROVED' },
    'COMPUTER_MCP_CHECKS_SUMMARY.json': summary
  })
  try {
    let cursor = null
    const discoveryCursors = new Set()
    for (let i = 0; i < 5; i++) {
      summary.tool_list_calls++
      const listed = await client.listTools(cursor === null ? {} : { cursor })
      if (!listed || !Array.isArray(listed.tools)) checkpoint('tool_metadata_invalid')
      for (const t of listed.tools) if (ALLOWED.has(t.name)) {
        if (definitions.some(d => d.name === t.name)) checkpoint('tool_metadata_ambiguous')
        definitions.push({ name: t.name, description: t.description ?? null, inputSchema: t.inputSchema,
          ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}) })
      }
      const next = listed.nextCursor
      if (next === undefined || next === null) break
      if (typeof next !== 'string' || !next || discoveryCursors.has(next)) checkpoint('tool_metadata_nonprogress')
      discoveryCursors.add(next)
      if (i === 4) checkpoint('metadata_listing_incomplete')
      cursor = next
    }
    for (const name of ALLOWED) {
      const schema = definitions.find(t => t.name === name)?.inputSchema
      const needed = name === 'list_thread_assets' ? ['thread_id', 'cursor'] : ['thread_id', 'asset_id']
      if (!schema || schema.type !== 'object' || needed.some(k => !schema.properties?.[k])) checkpoint('tool_contract_unverified')
      if ((schema.required || []).some(k => !needed.includes(k))) checkpoint('tool_contract_unverified')
    }
    async function call(name, args) {
      if (!ALLOWED.has(name) || args.thread_id !== COMPUTER_THREAD_ID) checkpoint('tool_out_of_scope')
      const keys = name === 'list_thread_assets' ? ['thread_id', 'cursor'] : ['thread_id', 'asset_id']
      if (Object.keys(args).some(k => !keys.includes(k)) ||
          (name === 'create_asset_download' && args.asset_id !== TARGET_ASSET_ID)) checkpoint('arguments_out_of_scope')
      const result = decodeProviderResult(await client.callTool({ name, arguments: args }))
      if (!result.ok) checkpoint(result.code)
      return result.value
    }
    cursor = null
    const seenCursors = new Set()
    const seenPages = new Set()
    const matches = []
    for (let i = 0; i < 10; i++) {
      const args = { thread_id: COMPUTER_THREAD_ID, ...(cursor === null ? {} : { cursor }) }
      summary.asset_list_calls++
      const parsed = await call('list_thread_assets', args)
      const checked = validateAssetPage(parsed)
      if (!checked.ok) checkpoint(checked.code)
      const ids = checked.assets.map(a => a.asset_id)
      if (ids.some(id => typeof id !== 'string' || !id)) checkpoint('asset_identity_missing')
      const fingerprint = hash(JSON.stringify([...ids].sort()))
      if (ids.length && seenPages.has(fingerprint)) checkpoint('listing_nonprogress')
      if (ids.length) seenPages.add(fingerprint)
      for (const a of checked.assets) {
        if (a.filename === `${TARGET_JOB_ID}.json` || a.asset_id === TARGET_ASSET_ID) matches.push(a)
      }
      pages.push({
        page_index: i, request_keys: Object.keys(args), request_cursor: cursorEvidence(cursor),
        asset_count: ids.length, asset_ids_sha256: fingerprint,
        asset_array_location: 'assets', next_cursor: cursorEvidence(checked.next_cursor)
      })
      cursor = checked.next_cursor
      if (cursor === null) { summary.terminal_observed = true; break }
      if (seenCursors.has(cursor)) checkpoint('listing_nonprogress')
      seenCursors.add(cursor)
      if (i === 9) checkpoint('listing_incomplete')
    }
    if (matches.length !== 1) checkpoint(matches.length ? 'target_ambiguous' : 'target_not_found')
    const target = matches[0]
    if (target.asset_id !== TARGET_ASSET_ID || target.filename !== `${TARGET_JOB_ID}.json`) checkpoint('target_identity_mismatch')
    matched = safeTarget(target)
    summary.download_metadata_calls++
    const meta = await call('create_asset_download', { thread_id: COMPUTER_THREAD_ID, asset_id: target.asset_id })
    if (meta.asset_id !== target.asset_id || typeof meta.url !== 'string' ||
        !Object.hasOwn(meta, 'expires_in_seconds') ||
        !(meta.expires_in_seconds === null || (Number.isFinite(meta.expires_in_seconds) && meta.expires_in_seconds >= 0))) checkpoint('download_metadata_invalid')
    let url
    try { url = new URL(meta.url) } catch { checkpoint('download_metadata_invalid') }
    if (url.protocol !== 'https:' || url.username || url.password) checkpoint('download_metadata_invalid')
    host = {
      scheme: 'https', hostname: url.hostname.toLowerCase(), port: url.port || null,
      asset_id: target.asset_id, expires_in_seconds: meta.expires_in_seconds,
      approval: 'OBSERVED_NOT_APPROVED', path_and_query_saved: false
    }
    summary.status = 'READ_ONLY_CAPTURE_COMPLETE'
  } catch (err) {
    summary.status = 'CHECKPOINT'
    summary.checkpoint = err?.checkpointCode || providerException(err).code
  }
  return { summary, documents: docs() }
}
