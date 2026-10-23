const { authenticateGatewayRequest, loadClientVerifiers } = require('./gatewayAuth.cjs')
const { requestAnalytics, getAnalyticsJob, getAnalyticsResult } = require('./worker.cjs')

function clientMetaFromAuth(auth) {
  return {
    clientId: auth.clientId,
    scopes: auth.scopes,
    allowedCustomers: auth.allowedCustomers,
    companyWideForbidden: auth.companyWideForbidden
  }
}

const TOOL_HANDLERS = {
  request_analytics: (auth, params) => {
    const operation = params?.operation
    const args = params?.arguments ?? params?.args ?? {}
    const idempotencyKey = params?.idempotency_key ? String(params.idempotency_key) : null
    return requestAnalytics(clientMetaFromAuth(auth), {
      operation,
      arguments: args,
      idempotencyKey
    })
  },
  get_analytics_job: (auth, params) => {
    const jobId = String(params?.job_id || params?.jobId || '')
    return getAnalyticsJob(jobId, clientMetaFromAuth(auth))
  },
  get_analytics_result: (auth, params) => {
    const jobId = String(params?.job_id || params?.jobId || '')
    return getAnalyticsResult(jobId, clientMetaFromAuth(auth))
  }
}

function handleGatewayRpc(body, authHeader) {
  const auth = authenticateGatewayRequest(authHeader, loadClientVerifiers())
  if (!auth.ok) {
    return { ok: false, status: 401, error: auth.message, code: auth.code }
  }

  if (process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED === 'false') {
    return { ok: false, status: 503, error: 'Analytics gateway disabled', code: 'disabled' }
  }

  const method = body?.method
  const params = body?.params || {}

  if (method === 'tools/list') {
    return {
      ok: true,
      status: 200,
      result: {
        tools: Object.keys(TOOL_HANDLERS).map((name) => ({
          name,
          description: `Bevvi analytics gateway tool: ${name}`
        }))
      }
    }
  }

  if (method === 'tools/call') {
    const toolName = params.name
    const handler = TOOL_HANDLERS[toolName]
    if (!handler) {
      return { ok: false, status: 400, error: `Unknown tool: ${toolName}` }
    }
    const toolResult = handler(auth, params.arguments || {})
    if (toolResult.ok === false && toolResult.error && !toolResult.jobId) {
      return { ok: false, status: 400, error: toolResult.error, code: toolResult.code }
    }
    return { ok: true, status: 200, result: toolResult }
  }

  return { ok: false, status: 400, error: `Unsupported method: ${method}` }
}

module.exports = {
  handleGatewayRpc,
  TOOL_HANDLERS,
  clientMetaFromAuth
}
