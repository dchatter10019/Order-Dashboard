const MAX_HANDLER_CACHE_AGE_HOURS = 24
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000
const CACHE_AGE_ROUNDING_TOLERANCE_HOURS = 0.02
const MAX_RESULT_AGE_AT_DELIVERY_MS = 7 * 24 * 60 * 60 * 1000

const EXACT_V3_CONTRACT = 'decision_support_v3_identity_and_input_guards'

function sha256HexPattern(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

function validateEvidenceTimestamps(payload, nowMs = Date.now()) {
  const prov = payload?.provenance
  if (!prov) return { ok: false, code: 'missing_provenance', message: 'provenance object required' }

  const generatedAt = payload.generated_at_utc || prov.generated_at_utc
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) {
    return { ok: false, code: 'missing_generation_time', message: 'generated_at_utc required' }
  }
  const genMs = Date.parse(generatedAt)
  if (genMs > nowMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    return { ok: false, code: 'future_generation', message: 'generated_at_utc is in the future' }
  }

  if (!prov.newest_cache_refresh_at_utc || Number.isNaN(Date.parse(prov.newest_cache_refresh_at_utc))) {
    return { ok: false, code: 'cache_timestamp_invalid', message: 'Invalid newest_cache_refresh_at_utc' }
  }
  const refreshMs = Date.parse(prov.newest_cache_refresh_at_utc)
  if (refreshMs > genMs + MAX_FUTURE_CLOCK_SKEW_MS) {
    return {
      ok: false,
      code: 'cache_after_generation',
      message: 'Cache refresh timestamp after generation time'
    }
  }

  const computedAgeHours = (genMs - refreshMs) / (3600 * 1000)
  if (computedAgeHours > MAX_HANDLER_CACHE_AGE_HOURS) {
    return {
      ok: false,
      code: 'cache_not_fresh',
      message: 'Computed cache age from timestamps exceeds 24h freshness policy'
    }
  }

  if (typeof prov.cache_age_hours !== 'number' || !Number.isFinite(prov.cache_age_hours) || prov.cache_age_hours < 0) {
    return { ok: false, code: 'cache_age_invalid', message: 'cache_age_hours must be a non-negative number' }
  }
  if (prov.cache_age_hours > MAX_HANDLER_CACHE_AGE_HOURS) {
    return { ok: false, code: 'cache_not_fresh', message: 'cache_age_hours exceeds 24h freshness policy' }
  }
  if (Math.abs(computedAgeHours - prov.cache_age_hours) > CACHE_AGE_ROUNDING_TOLERANCE_HOURS) {
    return {
      ok: false,
      code: 'cache_age_inconsistent',
      message: 'cache_age_hours inconsistent with generation and refresh timestamps'
    }
  }

  const ageAtDeliveryHours = (nowMs - refreshMs) / (3600 * 1000)
  if (ageAtDeliveryHours > MAX_RESULT_AGE_AT_DELIVERY_MS / (3600 * 1000)) {
    return { ok: false, code: 'cache_stale_at_delivery', message: 'Cache refresh too old at delivery' }
  }

  return { ok: true, generated_at_utc: generatedAt, cache_age_hours: prov.cache_age_hours }
}

function validateSettledCutoff(jobAsOf, provenance) {
  const asOf = String(jobAsOf || '')
  const settled = String(provenance?.settled_through || '')
  const { DATE_RE } = require('./calendarValidation.cjs')
  if (!settled || !DATE_RE.test(settled)) {
    return { ok: false, code: 'missing_settled_through', message: 'provenance.settled_through required' }
  }
  if (asOf > settled) {
    return {
      ok: false,
      code: 'as_of_after_settled_cutoff',
      message: 'Request as_of must be on or before conservative settled_through cutoff'
    }
  }
  if (String(provenance.as_of || '') !== asOf) {
    return { ok: false, code: 'provenance_as_of_mismatch', message: 'provenance.as_of must match job arguments' }
  }
  return { ok: true }
}

function validateSourceIdentity(payload) {
  const prov = payload?.provenance || {}
  const codeHash =
    prov.analysis_source_sha256 ||
    payload.analysis_source_sha256 ||
    prov.code_sha256 ||
    null
  const inputHash = prov.input_sha256 || null
  const { getApprovedAnalysisSourceSha256 } = require('./pythonToolsListLoader.cjs')
  const approved = getApprovedAnalysisSourceSha256()

  if (!sha256HexPattern(codeHash)) {
    return { ok: false, code: 'missing_code_hash', message: 'analysis_source_sha256 code identity required' }
  }
  if (!approved.includes(String(codeHash).toLowerCase())) {
    return { ok: false, code: 'unapproved_code_hash', message: 'analysis_source_sha256 not in approved release set' }
  }
  if (!sha256HexPattern(inputHash)) {
    return { ok: false, code: 'missing_input_hash', message: 'provenance.input_sha256 required' }
  }
  return {
    ok: true,
    source_hash: inputHash.toLowerCase(),
    code_hash: String(codeHash).toLowerCase()
  }
}

function validateExactContract(payload) {
  const contract = String(payload?.provenance?.analysis_contract || '')
  if (contract !== EXACT_V3_CONTRACT) {
    return {
      ok: false,
      code: 'invalid_contract',
      message: `Expected exact analysis_contract ${EXACT_V3_CONTRACT}`
    }
  }
  return { ok: true }
}

module.exports = {
  EXACT_V3_CONTRACT,
  MAX_HANDLER_CACHE_AGE_HOURS,
  validateEvidenceTimestamps,
  validateSettledCutoff,
  validateSourceIdentity,
  validateExactContract
}
