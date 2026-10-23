#!/usr/bin/env node
import assert from 'assert'
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { handleAnalyticsMcpRequest } from '../lib/analyticsGateway/createMcpGateway.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { sha256Hex } = require('../lib/analyticsGateway/gatewayAuth.cjs')

const saved = { ...process.env }
process.env.BEVVI_ANALYTICS_GATEWAY_MODE = 'mock'
process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED = 'true'
process.env.BEVVI_ANALYTICS_GATEWAY_JOBS_DIR = path.join(
  __dirname,
  '..',
  'data',
  'analytics-gateway',
  'sdk-handshake-jobs'
)
process.env.BEVVI_ANALYTICS_GATEWAY_CLIENTS_JSON = JSON.stringify({
  sdkClient: {
    tokenSha256: sha256Hex('sdk-handshake-token'),
    scopes: ['analytics:read', 'analytics:submit']
  }
})

const authInfo = {
  clientId: 'sdkClient',
  scopes: ['analytics:read', 'analytics:submit'],
  allowedCustomers: null,
  companyWideForbidden: false
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

const server = http.createServer(async (req, res) => {
  if (req.url !== '/analytics') {
    res.writeHead(404)
    res.end()
    return
  }
  let parsed
  if (req.method === 'POST') {
    const raw = await readBody(req)
    parsed = raw ? JSON.parse(raw) : undefined
  }
  req.headers.authorization = 'Bearer sdk-handshake-token'
  await handleAnalyticsMcpRequest(req, res, parsed, authInfo)
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()
const url = new URL(`http://127.0.0.1:${port}/analytics`)

const transport = new StreamableHTTPClientTransport(url, {
  requestInit: {
    headers: {
      Authorization: 'Bearer sdk-handshake-token'
    }
  }
})
const client = new Client({ name: 'sdk-handshake-test', version: '1.0.0' })
await client.connect(transport)

const tools = await client.listTools()
assert.ok(tools.tools.some((t) => t.name === 'request_analytics'))

const submit = await client.callTool({
  name: 'request_analytics',
  arguments: {
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotency_key: 'sdk-handshake-1'
  }
})
const submitJson = JSON.parse(submit.content[0].text)
assert.strictEqual(submitJson.ok, true)
const jobId = submitJson.jobId

await new Promise((r) => setTimeout(r, 500))

const status = await client.callTool({
  name: 'get_analytics_job',
  arguments: { job_id: jobId }
})
const statusJson = JSON.parse(status.content[0].text)
assert.strictEqual(statusJson.ok, true)
assert.strictEqual(statusJson.job.state, 'succeeded')

const result = await client.callTool({
  name: 'get_analytics_result',
  arguments: { job_id: jobId }
})
const resultJson = JSON.parse(result.content[0].text)
assert.strictEqual(resultJson.ok, true)
assert.strictEqual(resultJson.envelope.operation, 'bevvi_analysis_data_quality')

await client.close()
server.close()
process.env = saved

console.log('analytics-gateway-sdk-handshake-test: OK')
