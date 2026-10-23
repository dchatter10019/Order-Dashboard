import crypto from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { requestAnalytics, getAnalyticsJob, getAnalyticsResult } = require('./worker.cjs')
const { getRuntimeMode, validateModeConfiguration } = require('./modes.cjs')
const { getGatewayAuth, runWithGatewayAuthAsync } = require('./gatewayRequestContext.cjs')
const { clientMetaFromAuth } = require('./gatewayRpc.cjs')

const MAX_SESSIONS = 256
const IDLE_MS = 30 * 60 * 1000
/** @type {Map<string, { transport: StreamableHTTPServerTransport, open: number, lastActive: number, clientId: string }>} */
const sessions = new Map()

setInterval(() => {
  const cutoff = Date.now() - IDLE_MS
  for (const [sid, session] of sessions.entries()) {
    if (session.open === 0 && session.lastActive < cutoff) {
      session.transport.close().catch(() => {})
      sessions.delete(sid)
    }
  }
}, 60_000).unref()

function jsonText(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  }
}

function requireClientMeta() {
  const auth = getGatewayAuth()
  if (!auth?.clientId) {
    throw Object.assign(new Error('Missing authenticated client identity'), { code: 'unauthorized' })
  }
  return clientMetaFromAuth(auth)
}

function createMcpServer() {
  const mcpServer = new McpServer(
    { name: 'bevvi-analytics-gateway', version: '1.1.0' },
    { maxToolInputElements: 64 }
  )

  mcpServer.registerTool(
    'request_analytics',
    {
      description: 'Submit allowlisted analytics job',
      inputSchema: z.object({
        operation: z.string(),
        arguments: z.record(z.any()).optional(),
        idempotency_key: z.string().optional()
      })
    },
    async (args) => {
      const result = requestAnalytics(requireClientMeta(), {
        operation: args.operation,
        arguments: args.arguments || {},
        idempotencyKey: args.idempotency_key || null
      })
      return jsonText(result)
    }
  )

  mcpServer.registerTool(
    'get_analytics_job',
    {
      description: 'Get analytics job status',
      inputSchema: z.object({
        job_id: z.string()
      })
    },
    async (args) => jsonText(getAnalyticsJob(args.job_id, requireClientMeta()))
  )

  mcpServer.registerTool(
    'get_analytics_result',
    {
      description: 'Get job-bound analytics result envelope',
      inputSchema: z.object({
        job_id: z.string()
      })
    },
    async (args) => jsonText(getAnalyticsResult(args.job_id, requireClientMeta()))
  )

  return mcpServer
}

function trackResponse(session, res) {
  if (!res.socket || res.destroyed) return
  session.open += 1
  res.on('close', () => {
    session.open -= 1
    session.lastActive = Date.now()
  })
}

function sendJsonRpcError(res, status, code, message, id = null) {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id }))
}

function verifySessionOwnership(sessionId, authInfo) {
  const session = sessions.get(sessionId)
  if (!session) return { ok: false, status: 404, code: -32001, message: 'Session not found' }
  if (session.clientId !== authInfo.clientId) {
    return { ok: false, status: 403, code: -32002, message: 'Session belongs to another client' }
  }
  return { ok: true, session }
}

function rejectMalformedJsonRpc(parsedBody, res) {
  if (!parsedBody || typeof parsedBody !== 'object') {
    sendJsonRpcError(res, 400, -32700, 'Parse error')
    return true
  }
  if (parsedBody.jsonrpc && parsedBody.jsonrpc !== '2.0') {
    sendJsonRpcError(res, 400, -32600, 'Invalid JSON-RPC version', parsedBody.id ?? null)
    return true
  }
  return false
}

function isToolInvocation(parsedBody) {
  return parsedBody?.method === 'tools/call'
}

async function dispatchMcpPost(req, res, parsedBody, authInfo) {
  if (rejectMalformedJsonRpc(parsedBody, res)) return

  const sessionHeader = req.headers['mcp-session-id']
  const sessionId = sessionHeader ? String(sessionHeader) : ''
  const isNotification =
    typeof parsedBody?.method === 'string' && parsedBody.method.startsWith('notifications/')

  if (!sessionId && isNotification) {
    sendJsonRpcError(res, 400, -32000, 'Session required before notifications', null)
    return
  }

  if (!sessionId && isToolInvocation(parsedBody)) {
    sendJsonRpcError(res, 400, -32000, 'Session required before tool calls', parsedBody.id ?? null)
    return
  }

  if (sessionId) {
    const owned = verifySessionOwnership(sessionId, authInfo)
    if (!owned.ok) {
      sendJsonRpcError(res, owned.status, owned.code, owned.message, parsedBody?.id ?? null)
      return
    }
    trackResponse(owned.session, res)
    await owned.session.transport.handleRequest(req, res, parsedBody)
    return
  }

  if (!sessionId && isInitializeRequest(parsedBody)) {
    if (sessions.size >= MAX_SESSIONS) {
      sendJsonRpcError(res, 503, -32000, 'Too many open sessions', parsedBody?.id ?? null)
      return
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, {
          transport,
          open: 0,
          lastActive: Date.now(),
          clientId: authInfo.clientId
        })
      }
    })
    transport.onclose = () => {
      const sid = transport.sessionId
      if (sid && sessions.has(sid)) sessions.delete(sid)
    }

    const server = createMcpServer()
    await server.connect(transport)
    await transport.handleRequest(req, res, parsedBody)
    return
  }

  sendJsonRpcError(res, 400, -32000, 'Bad Request: No valid session ID provided', parsedBody?.id ?? null)
}

async function dispatchMcpGet(req, res, authInfo) {
  const sessionId = String(req.headers['mcp-session-id'] || '')
  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Missing Mcp-Session-Id header')
    return
  }
  const owned = verifySessionOwnership(sessionId, authInfo)
  if (!owned.ok) {
    sendJsonRpcError(res, owned.status, owned.code, owned.message)
    return
  }
  trackResponse(owned.session, res)
  await owned.session.transport.handleRequest(req, res)
}

async function dispatchMcpDelete(req, res, authInfo) {
  const sessionId = String(req.headers['mcp-session-id'] || '')
  if (!sessionId) {
    sendJsonRpcError(res, 400, -32000, 'Missing session id')
    return
  }
  const owned = verifySessionOwnership(sessionId, authInfo)
  if (!owned.ok) {
    sendJsonRpcError(res, owned.status, owned.code, owned.message)
    return
  }
  await owned.session.transport.close()
  sessions.delete(sessionId)
  res.writeHead(204)
  res.end()
}

export async function handleAnalyticsMcpRequest(req, res, parsedBody, authInfo) {
  if (!authInfo?.clientId) {
    sendJsonRpcError(res, 401, -32003, 'Missing authenticated client identity')
    return
  }
  const modeCheck = validateModeConfiguration(getRuntimeMode())
  if (!modeCheck.ok) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: modeCheck.message, code: modeCheck.code }))
    return
  }
  if (process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED === 'false') {
    sendJsonRpcError(res, 503, -32004, 'Analytics gateway disabled')
    return
  }

  req.auth = authInfo
  await runWithGatewayAuthAsync(authInfo, async () => {
    try {
      if (req.method === 'GET') {
        await dispatchMcpGet(req, res, authInfo)
        return
      }
      if (req.method === 'DELETE') {
        await dispatchMcpDelete(req, res, authInfo)
        return
      }
      await dispatchMcpPost(req, res, parsedBody, authInfo)
    } catch (err) {
      console.error('[analytics-gateway] MCP dispatch error:', err.message)
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, 'Internal server error')
      }
    }
  })
}

export function __testOnlyResetSessions() {
  sessions.clear()
}

export function __testOnlyGetSessions() {
  return sessions
}

export function __testOnlyRegisterSession(sessionId, clientId) {
  sessions.set(sessionId, {
    transport: {
      handleRequest: async () => {},
      close: async () => {}
    },
    open: 0,
    lastActive: Date.now(),
    clientId
  })
}
