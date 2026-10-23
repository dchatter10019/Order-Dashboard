#!/usr/bin/env node
/**
 * Session ownership, OAuth security, GET/SSE, and local smoke-mode guards.
 * Does not submit analytics jobs or refresh Computer cache.
 */
import fs from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { getOAuthAdminStatus } from '../lib/analyticsGateway/perplexityOAuthProvider.mjs'
import { verifyComputerConnectionReadOnly, probeReadOnlyThreadGuards } from '../lib/analyticsGateway/computerMcpLive.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const require = createRequire(import.meta.url)
const { validateModeConfiguration, getRuntimeMode } = require('../lib/analyticsGateway/modes.cjs')
const { COMPUTER_THREAD_ID } = require('../lib/analyticsGateway/constants.cjs')
const { isSettledAsOfEligible } = require('../lib/analyticsGateway/operationalGuards.cjs')
const { readStore, redactStoreForStatus, storePath } = require('../lib/analyticsGateway/perplexityOAuthStore.cjs')

const base = process.env.BEVVI_ANALYTICS_GATEWAY_VERIFY_URL || 'http://127.0.0.1:8791/analytics'
const token = process.env.BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN || ''
const setupKey = process.env.BEVVI_ANALYTICS_GATEWAY_SETUP_KEY || ''
const host = process.env.BEVVI_ANALYTICS_GATEWAY_HOST || '127.0.0.1'
const port = process.env.BEVVI_ANALYTICS_GATEWAY_PORT || '8791'

function fail(message) {
  console.error(`preflight: FAIL — ${message}`)
  process.exit(1)
}

function pass(label) {
  console.log(`preflight: OK — ${label}`)
}

if (getRuntimeMode() !== 'smoke') {
  fail(`BEVVI_ANALYTICS_GATEWAY_MODE must be smoke (got ${getRuntimeMode()})`)
}
const modeCheck = validateModeConfiguration('smoke')
if (!modeCheck.ok) fail(modeCheck.message)
pass('smoke mode configuration')

if (process.env.BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE === 'true') {
  fail('BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE must not be true')
}
if (process.env.BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK === 'true') {
  fail('BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK must not be true')
}
pass('production disabled; mock override off')

const settled = isSettledAsOfEligible('2026-10-02')
if (!settled.ok) fail(settled.message)
pass(`settled-date eligibility for as_of=2026-10-02 (Eastern today ${settled.easternToday})`)

if (!token) fail('BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN not set')
pass('gateway client token configured')

const setupProbe = await fetch(`http://${host}:${port}/analytics/admin/oauth/status`, {
  headers: {}
})
if (setupProbe.status !== 403) {
  fail('OAuth admin status must return 403 without setup key')
}
pass('OAuth admin routes reject missing setup key')

if (!setupKey) fail('BEVVI_ANALYTICS_GATEWAY_SETUP_KEY not set')
const setupAuth = await fetch(`http://${host}:${port}/analytics/admin/oauth/status`, {
  headers: { 'X-Bevvi-Analytics-Setup-Key': setupKey }
})
if (setupAuth.status !== 200) fail('OAuth admin status must accept setup key')
const setupBody = await setupAuth.json()
if (setupBody.tokens || setupBody.access_token) {
  fail('OAuth admin status must not expose token values')
}
pass('OAuth admin status redacted with valid setup key')

const badAuth = await fetch(base, {
  method: 'POST',
  headers: {
    Authorization: 'Bearer invalid-token',
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'x', version: '1' } }
  })
})
if (badAuth.status !== 401) fail(`Invalid Bearer must return 401 (got ${badAuth.status})`)
pass('gateway Bearer authentication enforced')

async function connectClient(name) {
  const transport = new StreamableHTTPClientTransport(new URL(base), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  })
  const client = new Client({ name, version: '1.0.0' })
  await client.connect(transport)
  return { client, transport }
}

const a = await connectClient('preflight-a')
pass('MCP initialize + notifications (client A)')

const badSession = await fetch(base, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'mcp-session-id': '00000000-0000-0000-0000-000000000000'
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 99,
    method: 'tools/list',
    params: {}
  })
})
if (badSession.status !== 404) {
  await a.client.close()
  fail(`Unknown session must return 404 (got ${badSession.status})`)
}
pass('session ownership rejects unknown Mcp-Session-Id')

const sessionIdForSse = a.transport.sessionId
if (!sessionIdForSse) {
  await a.client.close()
  fail('Expected Mcp-Session-Id after initialize')
}
await a.client.close()

const sseRes = await fetch(base, {
  method: 'GET',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'text/event-stream',
    'mcp-session-id': sessionIdForSse
  }
})
if (![200, 405].includes(sseRes.status)) {
  fail(`GET SSE unexpected status ${sseRes.status} (expected 200 or 405 on closed POST session)`)
}
await sseRes.body?.cancel?.()
pass(`GET/SSE on initialized session (${sseRes.status})`)

const b = await connectClient('preflight-b')
await b.client.close()
pass('second independent MCP session initializes (no already-initialized error)')

const oauthStatus = getOAuthAdminStatus()
if (!oauthStatus.hasTokens) {
  fail('Administrator OAuth tokens missing — complete browser sign-in first')
}
pass('OAuth token store present (redacted status)')

const oauthFile = storePath()
try {
  const st = fs.statSync(oauthFile)
  if ((st.mode & 0o777) !== 0o600) {
    fail(`OAuth store permissions must be 600 (got ${(st.mode & 0o777).toString(8)})`)
  }
  pass('OAuth store file permissions 600')
} catch (err) {
  if (err.code === 'ENOENT') fail('OAuth store file missing')
  throw err
}

const store = redactStoreForStatus(readStore())
if (store.hasTokens && !store.hasRefreshToken) {
  console.warn('preflight: WARN — no refresh token in store (short-lived sessions)')
}

const computer = await verifyComputerConnectionReadOnly()
if (!computer.ok) {
  fail(`Computer MCP read-only verify failed (thread ${COMPUTER_THREAD_ID})`)
}
pass(`Computer MCP tools: read_thread + call_perplexity_computer on thread ${COMPUTER_THREAD_ID}`)

const threadProbe = await probeReadOnlyThreadGuards()
if (!threadProbe.ok) {
  fail(threadProbe.message || 'read_thread probe failed')
}
const hints = threadProbe.hints || {}
if (hints.use_xgboost === true) {
  fail('read_thread hints show use_xgboost=true (live gate must be OFF)')
}
if (hints.gate_status && ['on', 'enabled', 'live', 'open'].includes(String(hints.gate_status).toLowerCase())) {
  fail(`read_thread hints show live gate ${hints.gate_status}`)
}
pass('read-only thread probe (no handler run, no cache refresh)')

console.log('analytics-gateway-preflight-checks: OK')
