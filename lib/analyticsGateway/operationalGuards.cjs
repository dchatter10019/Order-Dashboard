const { COMPUTER_THREAD_ID } = require('./constants.cjs')

/** Local eligibility: as_of must be a settled calendar day (not today/future in US/Eastern). */
function isSettledAsOfEligible(asOf, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(asOf || ''))) {
    return { ok: false, code: 'invalid_as_of', message: 'as_of must be YYYY-MM-DD' }
  }
  const eastern = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now)
  if (asOf >= eastern) {
    return {
      ok: false,
      code: 'as_of_not_settled',
      message: `as_of ${asOf} is not settled (Eastern today is ${eastern})`
    }
  }
  return { ok: true, easternToday: eastern }
}

function coerceBool(value) {
  if (value === true || value === false) return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true' || v === 'on' || v === 'enabled') return true
    if (v === 'false' || v === 'off' || v === 'disabled') return false
  }
  return null
}

const { extractDecisionSupportV3Payload, validateDecisionSupportV3 } = require('./decisionSupportV3.cjs')

/** Validates decision_support_v3 handler JSON (fail-closed). */
function validateDataQualityOperationalGuards(payload, { asOf, job = null, threadId = COMPUTER_THREAD_ID } = {}) {
  const extracted = extractDecisionSupportV3Payload(payload) || payload
  const jobStub = job || {
    jobId: extracted?.job_id || 'unknown',
    operation: extracted?.operation || 'bevvi_analysis_data_quality',
    arguments: { as_of: asOf }
  }
  const v3 = validateDecisionSupportV3(extracted, jobStub)
  if (!v3.ok) return v3
  return {
    ok: true,
    checks: {
      analysis_contract: 'decision_support_v3',
      as_of: asOf,
      handler_live_gate_status: v3.handler_live_gate_status,
      cache_age_hours: extracted?.provenance?.cache_age_hours
    },
    certification_warnings: v3.certification_warnings
  }
}

module.exports = {
  isSettledAsOfEligible,
  validateDataQualityOperationalGuards
}
