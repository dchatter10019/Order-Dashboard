const DEFAULT_MAX_BODY_BYTES = 256 * 1024
const DEFAULT_MAX_QUEUE_DEPTH = 64
const DEFAULT_MAX_JOBS_PER_CLIENT = 32
const DEFAULT_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000

function intEnv(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

function getGatewayLimits() {
  return {
    maxBodyBytes: intEnv('BEVVI_ANALYTICS_GATEWAY_MAX_BODY_BYTES', DEFAULT_MAX_BODY_BYTES),
    maxQueueDepth: intEnv('BEVVI_ANALYTICS_GATEWAY_MAX_QUEUE_DEPTH', DEFAULT_MAX_QUEUE_DEPTH),
    maxJobsPerClient: intEnv('BEVVI_ANALYTICS_GATEWAY_MAX_JOBS_PER_CLIENT', DEFAULT_MAX_JOBS_PER_CLIENT),
    jobRetentionMs: intEnv('BEVVI_ANALYTICS_GATEWAY_JOB_RETENTION_MS', DEFAULT_JOB_RETENTION_MS),
    requestTimeoutMs: intEnv('BEVVI_ANALYTICS_GATEWAY_REQUEST_TIMEOUT_MS', 120_000)
  }
}

function validateStartupEnvironment() {
  const mode = String(process.env.BEVVI_ANALYTICS_GATEWAY_MODE || 'mock').toLowerCase()
  const prod = process.env.BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE === 'true'
  const smoke = process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE === 'true'
  const localTest = process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ENABLE === 'true'
  const allowMock = process.env.BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK === 'true'

  if (prod && smoke) {
    return { ok: false, code: 'conflicting_flags', message: 'Production and smoke enable flags are mutually exclusive' }
  }
  if (localTest && (prod || smoke)) {
    return {
      ok: false,
      code: 'conflicting_flags',
      message: 'LOCAL_TEST_ENABLE cannot be combined with production or smoke enable flags'
    }
  }
  if (mode === 'local_test' && !localTest) {
    return { ok: false, code: 'local_test_disabled', message: 'MODE=local_test requires LOCAL_TEST_ENABLE=true' }
  }
  if (localTest && mode !== 'local_test') {
    return {
      ok: false,
      code: 'conflicting_flags',
      message: 'LOCAL_TEST_ENABLE requires MODE=local_test'
    }
  }
  if (mode === 'production' && allowMock) {
    return { ok: false, code: 'conflicting_flags', message: 'ALLOW_MOCK cannot be set in production mode' }
  }
  if (mode === 'smoke' && allowMock) {
    return { ok: false, code: 'conflicting_flags', message: 'ALLOW_MOCK cannot be set in smoke mode' }
  }
  if (mode === 'mock' && prod) {
    return { ok: false, code: 'conflicting_flags', message: 'MODE=mock with PRODUCTION_ENABLE is invalid' }
  }

  const host = process.env.BEVVI_ANALYTICS_GATEWAY_HOST || '127.0.0.1'
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    return {
      ok: false,
      code: 'bind_policy',
      message: 'Gateway must bind to loopback unless explicitly approved for remote bind'
    }
  }

  const { assertToolsListIntegrity } = require('./pythonToolsListLoader.cjs')
  const toolsIntegrity = assertToolsListIntegrity()
  if (!toolsIntegrity.ok) {
    return {
      ok: false,
      code: toolsIntegrity.code || 'tools_list_integrity',
      message: toolsIntegrity.message
    }
  }

  try {
    const { assertAdvisoryLockCapability } = require('./osAdvisoryLock.cjs')
    assertAdvisoryLockCapability()
  } catch (err) {
    return {
      ok: false,
      code: err.code || 'advisory_lock_unavailable',
      message: err.message
    }
  }

  return { ok: true }
}

module.exports = {
  getGatewayLimits,
  validateStartupEnvironment
}
