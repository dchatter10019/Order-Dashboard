#!/usr/bin/env node
/**
 * Verifies /analytics using @modelcontextprotocol/sdk (initialize, tools/list, tools/call).
 * Requires gateway running in mock mode with BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN set.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const base = process.env.BEVVI_ANALYTICS_GATEWAY_VERIFY_URL || 'http://127.0.0.1:8791/analytics'
const token = process.env.BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN || 'test-gateway-token'

const badTransport = new StreamableHTTPClientTransport(new URL(base), {
  requestInit: { headers: { Authorization: 'Bearer invalid-token' } }
})
const badClient = new Client({ name: 'bevvi-analytics-gateway-verify-bad', version: '1.0.0' })
try {
  await badClient.connect(badTransport)
  throw new Error('Expected unauthorized connect to fail')
} catch (err) {
  const code = err?.code ?? err?.status
  if (code !== 401 && !String(err?.message || '').includes('401')) {
    throw new Error(`Expected 401 for bad token, got: ${err?.message || err}`)
  }
}

const transport = new StreamableHTTPClientTransport(new URL(base), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }
})

const client = new Client({ name: 'bevvi-analytics-gateway-verify', version: '1.0.0' })

await client.connect(transport)
console.log('initialize: OK (Streamable HTTP POST + notifications/initialized)')

const tools = await client.listTools()
const names = tools.tools.map((t) => t.name)
for (const required of ['request_analytics', 'get_analytics_job', 'get_analytics_result']) {
  if (!names.includes(required)) {
    throw new Error(`Missing gateway tool: ${required}`)
  }
}

const submit = await client.callTool({
  name: 'request_analytics',
  arguments: {
    operation: 'bevvi_analysis_data_quality',
    arguments: { as_of: '2026-10-02' },
    idempotency_key: `mcp-verify-${Date.now()}`
  }
})

function toolPayload(result) {
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (text) return JSON.parse(text)
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent
  }
  const { content, isError, ...rest } = result
  if (Object.keys(rest).length) return rest
  throw new Error(`Empty tool result: ${JSON.stringify(result)}`)
}

const submitJson = toolPayload(submit)
if (!submitJson.jobId) throw new Error('request_analytics did not return jobId')

await new Promise((r) => setTimeout(r, 400))

const status = await client.callTool({
  name: 'get_analytics_job',
  arguments: { job_id: submitJson.jobId }
})
const statusJson = toolPayload(status)
if (statusJson.job?.state !== 'succeeded') {
  throw new Error(`Expected succeeded, got ${statusJson.job?.state}`)
}

const result = await client.callTool({
  name: 'get_analytics_result',
  arguments: { job_id: submitJson.jobId }
})
const envelope = toolPayload(result).envelope
if (!envelope || envelope.operation !== 'bevvi_analysis_data_quality') {
  throw new Error('Invalid result envelope')
}

await client.close()
console.log('analytics-gateway-mcp-verify: OK')
