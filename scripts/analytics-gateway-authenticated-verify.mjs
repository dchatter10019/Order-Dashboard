#!/usr/bin/env node
/**
 * Post-OAuth authenticated checks (redacted): store, discovery, PKCE/state cleanup, Computer read-only.
 */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { probeReadOnlyThreadGuards, verifyComputerConnectionReadOnly } from '../lib/analyticsGateway/computerMcpLive.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const require = createRequire(import.meta.url)
const { ISSUER, storePath, readStore, redactStoreForStatus } = require('../lib/analyticsGateway/perplexityOAuthStore.cjs')
const { COMPUTER_MCP_URL, COMPUTER_THREAD_ID } = require('../lib/analyticsGateway/constants.cjs')

const report = {
  ok: false,
  store: {},
  oauth_flow: {},
  discovery: {},
  computer: {},
  blockers: []
}

function fail(code, message) {
  report.blockers.push({ code, message })
}

try {
  const file = storePath()
  const st = fs.statSync(file)
  const redacted = redactStoreForStatus(readStore())
  const store = readStore()
  const now = Date.now()
  const expiresAt = redacted.tokenExpiresAt
  const msLeft = typeof expiresAt === 'number' ? expiresAt - now : null

  report.store = {
    file_permissions_ok: (st.mode & 0o777) === 0o600,
    hasClient: redacted.hasClient,
    hasTokens: redacted.hasTokens,
    hasRefreshToken: redacted.hasRefreshToken,
    tokenExpiresAt: expiresAt,
    token_expires_in_ms: msLeft,
    token_not_expired: msLeft == null ? null : msLeft > 60_000,
    updatedAt: redacted.updatedAt,
    root_issuer_field: store.issuer || null,
    client_information_has_issuer: Boolean(store.clientInformation?.issuer),
    tokens_object_has_issuer: Boolean(store.tokens?.issuer),
    pending_authorization_url_still_set: Boolean(store.pendingAuthorizationUrl)
  }

  if (!redacted.hasTokens) fail('missing_tokens', 'Access tokens not present')
  if (!redacted.hasClient) fail('missing_client', 'OAuth client registration missing')
  if (!report.store.file_permissions_ok) fail('permissions', 'OAuth store must be mode 600')
  if (msLeft != null && msLeft <= 60_000) fail('token_expiry', 'Access token expired or expiring within 60s')

  report.oauth_flow = {
    pkce_verifier_cleared: !store.codeVerifier,
    oauth_state_cleared: !store.oauthState,
    callback_completed: Boolean(redacted.hasTokens && !store.codeVerifier && !store.oauthState)
  }
  if (!report.oauth_flow.callback_completed) {
    fail('incomplete_flow', 'PKCE verifier or OAuth state still present after token save')
  }

  const metadataUrl = new URL(COMPUTER_MCP_URL)
  metadataUrl.pathname = `${metadataUrl.pathname.replace(/\/$/, '')}/.well-known/oauth-authorization-server`
  const discoveryRes = await fetch(metadataUrl.toString(), {
    headers: { Accept: 'application/json' }
  })
  report.discovery = {
    url: metadataUrl.toString(),
    http_status: discoveryRes.status,
    ok: discoveryRes.ok
  }
  if (discoveryRes.ok) {
    const meta = await discoveryRes.json()
    report.discovery.issuer = meta.issuer || null
    report.discovery.scopes_supported = meta.scopes_supported || null
    report.discovery.token_endpoint_present = Boolean(meta.token_endpoint)
    report.discovery.authorization_endpoint_present = Boolean(meta.authorization_endpoint)
    if (meta.issuer && meta.issuer !== ISSUER) {
      fail('issuer_mismatch', 'Discovery issuer does not match configured ISSUER constant')
    }
  } else {
    fail('discovery_failed', `Authorization server metadata HTTP ${discoveryRes.status}`)
  }

  const computerTools = await verifyComputerConnectionReadOnly()
  report.computer.tools = computerTools.ok
    ? { ok: true, threadId: computerTools.threadId, tool_count: computerTools.tools?.length }
    : { ok: false, threadId: COMPUTER_THREAD_ID }
  if (!computerTools.ok) fail('computer_tools', 'read_thread or call_perplexity_computer unavailable')

  const threadProbe = await probeReadOnlyThreadGuards()
  report.computer.thread_probe = threadProbe.ok
    ? { ok: true, threadId: threadProbe.threadId, hints: threadProbe.hints || {} }
    : { ok: false, code: threadProbe.code, message: threadProbe.message }
  if (!threadProbe.ok) fail('thread_probe', threadProbe.message || 'read_thread probe failed')

  report.ok = report.blockers.length === 0
} catch (err) {
  fail('exception', err.message)
}

console.log(JSON.stringify(report, null, 2))
process.exit(report.ok ? 0 : 1)
