const { parseJsonStrict } = require('./resultRetrieval.cjs')
const {
  EXACT_V3_CONTRACT,
  validateEvidenceTimestamps,
  validateSettledCutoff,
  validateSourceIdentity,
  validateExactContract
} = require('./evidencePolicy.cjs')
const { validateHandlerOutputShape } = require('./pythonToolsListLoader.cjs')

function extractDecisionSupportV3Payload(raw) {
  if (!raw || typeof raw !== 'object') return null
  const handler = raw.handler_result || raw
  if (handler?.provenance?.analysis_contract === EXACT_V3_CONTRACT) return handler
  if (raw.text && typeof raw.text === 'string') {
    const parsed = parseJsonStrict(raw.text)
    if (parsed?.handler_result?.provenance?.analysis_contract === EXACT_V3_CONTRACT) {
      return parsed.handler_result
    }
    if (parsed?.provenance?.analysis_contract === EXACT_V3_CONTRACT) return parsed
  }
  return null
}

function normalizeLiveGateOff(value) {
  if (value == null) return null
  const s = String(value).trim().toUpperCase()
  return s === 'OFF' || s === 'FALSE' || s === 'DISABLED'
}

function validateDecisionSupportV3(payload, job, { nowMs = Date.now(), wrappedHandler = false } = {}) {
  const warnings = []
  if (!payload || typeof payload !== 'object') {
    return { ok: false, code: 'invalid_payload', message: 'Missing handler JSON object' }
  }

  const contractCheck = validateExactContract(payload)
  if (!contractCheck.ok) return contractCheck

  const outputStructure = validateHandlerOutputShape(job.operation, payload)
  if (!outputStructure.ok) return outputStructure

  const prov = payload.provenance
  if (!prov || typeof prov !== 'object') {
    return { ok: false, code: 'missing_provenance', message: 'provenance object required' }
  }

  const settled = validateSettledCutoff(job.arguments?.as_of, prov)
  if (!settled.ok) return settled

  const timestamps = validateEvidenceTimestamps(payload, nowMs)
  if (!timestamps.ok) return timestamps

  const source = validateSourceIdentity(payload)
  if (!source.ok) return source

  if (wrappedHandler && (payload.job_id || payload.operation || payload.request_hash)) {
    return {
      ok: false,
      code: 'handler_augmentation',
      message: 'Handler must not contain gateway job identity fields'
    }
  }

  if (prov.phase1_active !== true) {
    return { ok: false, code: 'phase1_inactive', message: 'provenance.phase1_active must be true' }
  }

  const handlerGate = payload.live_gate_status ?? prov.live_gate_status
  if (!normalizeLiveGateOff(handlerGate)) {
    return { ok: false, code: 'live_gate_not_off', message: 'Handler live_gate_status must be OFF' }
  }
  if (prov.live_gate_status != null && !normalizeLiveGateOff(prov.live_gate_status)) {
    return { ok: false, code: 'conflicting_gate', message: 'provenance.live_gate_status must be OFF' }
  }

  if (payload.review_only !== true) {
    return { ok: false, code: 'not_review_only', message: 'review_only must be true' }
  }
  if (payload.production_ready !== false) {
    return { ok: false, code: 'production_ready_set', message: 'production_ready must be false' }
  }
  if (payload.writes_performed !== false) {
    return { ok: false, code: 'writes_performed', message: 'writes_performed must be false' }
  }

  if (prov.business_date_completeness_verified === false) {
    warnings.push({
      code: 'business_date_completeness_unverified',
      message: 'business_date_completeness_verified is false'
    })
  }
  if (payload.financial_certification && payload.financial_certification !== 'certified') {
    warnings.push({
      code: 'financial_not_certified',
      message: String(payload.financial_certification)
    })
  }
  if (Array.isArray(prov.known_limitations) && prov.known_limitations.length) {
    warnings.push({ code: 'provenance_known_limitations', items: prov.known_limitations })
  }
  if (Array.isArray(payload.known_limitations) && payload.known_limitations.length) {
    warnings.push({ code: 'known_limitations', items: payload.known_limitations })
  }

  return {
    ok: true,
    handler_live_gate_status: 'OFF',
    source_hash: source.source_hash,
    generated_at_utc: timestamps.generated_at_utc,
    certification_warnings: warnings,
    integration_passed: true,
    data_quality_certified: false,
    production_readiness_approved: false
  }
}

module.exports = {
  EXACT_V3_CONTRACT,
  extractDecisionSupportV3Payload,
  validateDecisionSupportV3
}
