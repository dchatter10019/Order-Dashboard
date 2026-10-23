import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const TERMINAL_FAIL = new Set(['failed', 'needs_auth', 'needs_input', 'validation_failed', 'delivery_failed'])
const WAIT_STATES = new Set([
  'queued',
  'running',
  'validating',
  'awaiting_artifact',
  'submission_uncertain'
])

function gatewayConfig() {
  const base = String(
    process.env.BEVVI_ANALYTICS_GATEWAY_URL ||
      process.env.BEVVI_ANALYTICS_GATEWAY_VERIFY_URL ||
      'http://127.0.0.1:8791/analytics'
  ).trim()
  const token = String(process.env.BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN || '').trim()
  if (!token) {
    return { ok: false, code: 'gateway_not_configured', message: 'BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN is not set' }
  }
  return { ok: true, base, token }
}

function toolPayload(result) {
  const text = result.content?.find((c) => c.type === 'text')?.text
  if (text) return JSON.parse(text)
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent
  }
  const { content, isError, ...rest } = result
  if (Object.keys(rest).length) return rest
  throw new Error('Empty MCP tool result')
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function withGatewayClient(fn) {
  const cfg = gatewayConfig()
  if (!cfg.ok) return cfg

  const transport = new StreamableHTTPClientTransport(new URL(cfg.base), {
    requestInit: { headers: { Authorization: `Bearer ${cfg.token}` } }
  })
  const client = new Client({ name: 'bevvi-order-dashboard', version: '1.0.0' })
  try {
    await client.connect(transport)
    return await fn(client)
  } finally {
    await client.close().catch(() => {})
  }
}

export async function submitGatewayAnalyticsJob({ operation, arguments: args, idempotencyKey = null }) {
  return withGatewayClient(async (client) => {
    const submitArgs = { operation, arguments: args || {} }
    if (idempotencyKey) submitArgs.idempotency_key = idempotencyKey
    const submit = await client.callTool({ name: 'request_analytics', arguments: submitArgs })
    const submitJson = toolPayload(submit)
    if (!submitJson.ok && submitJson.code) {
      return { ok: false, code: submitJson.code, message: submitJson.error || submitJson.message || 'Submit rejected' }
    }
    if (!submitJson.jobId) {
      return { ok: false, code: 'invalid_submit', message: 'Gateway did not return jobId' }
    }
    return { ok: true, jobId: submitJson.jobId, state: submitJson.state }
  })
}

export async function pollGatewayAnalyticsJob(jobId, { waitMs = 0 } = {}) {
  if (waitMs > 0) await sleep(waitMs)
  return withGatewayClient(async (client) => {
    const status = toolPayload(
      await client.callTool({ name: 'get_analytics_job', arguments: { job_id: jobId } })
    )
    const state = status.job?.state
    if (WAIT_STATES.has(state) || state === 'queued' || state === 'running') {
      return { ok: false, code: 'pending', jobId, state, message: `Job still ${state}` }
    }
    if (state !== 'succeeded') {
      return {
        ok: false,
        code: state || 'not_ready',
        jobId,
        message: status.job?.error?.message || `Job state ${state}`
      }
    }
    const resultTool = toolPayload(
      await client.callTool({ name: 'get_analytics_result', arguments: { job_id: jobId } })
    )
    if (!resultTool.ok || !resultTool.envelope) {
      return {
        ok: false,
        code: resultTool.code || 'not_ready',
        jobId,
        message: resultTool.error?.message || 'Result not available'
      }
    }
    return { ok: true, jobId, envelope: resultTool.envelope }
  })
}

export async function runGatewayAnalyticsJob({ operation, arguments: args, idempotencyKey = null }) {
  const submitted = await submitGatewayAnalyticsJob({ operation, arguments: args, idempotencyKey })
  if (!submitted.ok) return submitted

  const deadline = Date.now() + Number(process.env.BEVVI_ANALYTICS_GATEWAY_POLL_TIMEOUT_MS || 900000)
  let lastState = submitted.state

  while (Date.now() < deadline) {
    await sleep(3000)
    const statusResult = await withGatewayClient(async (client) => {
      const status = toolPayload(
        await client.callTool({ name: 'get_analytics_job', arguments: { job_id: submitted.jobId } })
      )
      return status.job?.state
    })
    if (statusResult && statusResult.ok === false) return statusResult
    lastState = statusResult
    if (lastState === 'succeeded') return pollGatewayAnalyticsJob(submitted.jobId)
    if (TERMINAL_FAIL.has(lastState)) {
      return { ok: false, code: lastState, jobId: submitted.jobId, message: `Job ended in state ${lastState}` }
    }
    if (!WAIT_STATES.has(lastState) && lastState !== 'succeeded') {
      return {
        ok: false,
        code: 'unexpected_state',
        jobId: submitted.jobId,
        message: `Unexpected state ${lastState}`
      }
    }
  }

  return {
    ok: false,
    code: 'timeout',
    jobId: submitted.jobId,
    message: `Timed out waiting for job (last state ${lastState})`
  }
}

export function isGatewayConfigured() {
  return gatewayConfig().ok
}
