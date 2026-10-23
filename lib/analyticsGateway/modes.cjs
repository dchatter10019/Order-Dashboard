const { ALLOWED_OPERATIONS } = require('./operations.cjs')

const VALID_MODES = new Set(['mock', 'smoke', 'production', 'local_test'])

function getRuntimeMode() {
  const mode = String(process.env.BEVVI_ANALYTICS_GATEWAY_MODE || 'mock').toLowerCase()
  if (!VALID_MODES.has(mode)) {
    throw new Error(`Invalid BEVVI_ANALYTICS_GATEWAY_MODE: ${mode}`)
  }
  return mode
}

/** Fail-closed checks before serving traffic or running live jobs. */
function validateModeConfiguration(mode = getRuntimeMode()) {
  const prodFlag = process.env.BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE === 'true'
  const smokeFlag = process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE === 'true'
  const localTestFlag = process.env.BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ENABLE === 'true'
  const mockOverride = process.env.BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK === 'true'

  if (mode === 'production') {
    if (!prodFlag) {
      return { ok: false, code: 'production_disabled', message: 'Set BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE=true after smoke approval' }
    }
    if (mockOverride) {
      return { ok: false, code: 'production_fail_closed', message: 'BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK must not be true in production' }
    }
    if (process.env.BEVVI_ANALYTICS_GATEWAY_MODE === 'mock') {
      return { ok: false, code: 'production_fail_closed', message: 'MODE=mock cannot be used with production enablement' }
    }
  }

  if (mode === 'smoke') {
    if (!smokeFlag) {
      return { ok: false, code: 'smoke_disabled', message: 'Set BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE=true for authorized live smoke tests' }
    }
    if (mockOverride) {
      return { ok: false, code: 'smoke_fail_closed', message: 'BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK must not be true for smoke mode' }
    }
    if (localTestFlag) {
      return { ok: false, code: 'conflicting_flags', message: 'LOCAL_TEST_ENABLE must not be true in smoke mode' }
    }
  }

  if (mode === 'local_test') {
    if (!localTestFlag) {
      return { ok: false, code: 'local_test_disabled', message: 'Set BEVVI_ANALYTICS_GATEWAY_LOCAL_TEST_ENABLE=true for approved local test runs' }
    }
    if (smokeFlag || prodFlag) {
      return { ok: false, code: 'conflicting_flags', message: 'LOCAL_TEST mode requires smoke and production enable flags to be false' }
    }
    if (mockOverride) {
      return { ok: false, code: 'local_test_fail_closed', message: 'BEVVI_ANALYTICS_GATEWAY_ALLOW_MOCK must not be true for local_test mode' }
    }
  }

  if ((mode === 'mock' || mode === 'production') && localTestFlag) {
    return { ok: false, code: 'conflicting_flags', message: 'LOCAL_TEST_ENABLE is only valid with MODE=local_test' }
  }

  return { ok: true, mode }
}

function isLiveComputerMode(mode = getRuntimeMode()) {
  return mode === 'smoke' || mode === 'production' || mode === 'local_test'
}

function isOperationAllowedInMode(operation, mode = getRuntimeMode()) {
  if (!ALLOWED_OPERATIONS.has(operation)) return false
  if (mode === 'mock') return true
  if (mode === 'smoke') return operation === 'bevvi_analysis_data_quality'
  if (mode === 'local_test') {
    const { APPROVED_ENTRIES_TEMPLATE } = require('./localTestManifest.cjs')
    return APPROVED_ENTRIES_TEMPLATE.some((entry) => entry.operation === operation)
  }
  return true
}

module.exports = {
  VALID_MODES,
  getRuntimeMode,
  validateModeConfiguration,
  isLiveComputerMode,
  isOperationAllowedInMode
}
