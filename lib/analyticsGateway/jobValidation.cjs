const { buildResultEnvelope, redactConsumerEnvelope } = require('./resultEnvelope.cjs')
const { unwrapArtifactPayload } = require('./jobBinding.cjs')
const { validateStructuredResult } = require('./resultRetrieval.cjs')
const { extractDecisionSupportV3Payload, validateDecisionSupportV3 } = require('./decisionSupportV3.cjs')
const { applyPlanningHorizonSelection } = require('./mockHandlerResult.cjs')
const { getRuntimeMode } = require('./modes.cjs')

function appendAudit(job, entry) {
  const auditHistory = Array.isArray(job.auditHistory) ? [...job.auditHistory] : []
  auditHistory.push({ at: new Date().toISOString(), ...entry })
  return auditHistory
}

function finalizeValidatedJob({
  job,
  rawResult,
  assetIdentity = null,
  gatewayMode = getRuntimeMode(),
  nowMs = Date.now()
}) {
  const requireBinding =
    gatewayMode === 'smoke' || gatewayMode === 'production' || gatewayMode === 'local_test'

  if (gatewayMode === 'mock') {
    const unwrapped = unwrapArtifactPayload(rawResult)
    let handlerResult = unwrapped.ok ? unwrapped.handlerResult : rawResult
    if (
      job.operation === 'bevvi_planning_forecast' &&
      job.gatewayOutputSelection?.horizon_days
    ) {
      handlerResult = applyPlanningHorizonSelection(
        handlerResult,
        job.gatewayOutputSelection.horizon_days
      )
    }
    const envelope = buildResultEnvelope({
      job,
      result: handlerResult,
      gatewayMode: 'mock',
      validatedEvidence: {
        handler_live_gate_status: 'MOCK',
        generated_at_utc: new Date(nowMs).toISOString(),
        source_hash: null
      },
      assetIdentity,
      integrationPassed: true,
      dataQualityCertified: false,
      productionReadinessApproved: false,
      certificationWarnings: [{ code: 'fixture', message: 'Mock fixture result' }]
    })
    return { ok: true, state: 'succeeded', envelope: redactConsumerEnvelope(envelope), validation: { ok: true } }
  }

  const structured = validateStructuredResult({
    job,
    payload: rawResult,
    assetIdentity,
    requireBinding
  })
  if (!structured.ok) {
    return {
      ok: false,
      state: 'validation_failed',
      error: { code: structured.code, message: structured.message }
    }
  }

  const payload = extractDecisionSupportV3Payload(structured.normalized) || structured.normalized
  if (!payload) {
    return {
      ok: false,
      state: 'validation_failed',
      error: { code: 'unparseable_v3', message: 'Could not extract decision_support_v3 JSON' }
    }
  }

  const v3 = validateDecisionSupportV3(payload, job, {
    nowMs,
    wrappedHandler: structured.wrapped
  })
  if (!v3.ok) {
    return {
      ok: false,
      state: 'validation_failed',
      error: { code: v3.code, message: v3.message }
    }
  }

  let resultForEnvelope = payload
  if (
    job.operation === 'bevvi_planning_forecast' &&
    job.gatewayOutputSelection?.horizon_days
  ) {
    resultForEnvelope = applyPlanningHorizonSelection(payload, job.gatewayOutputSelection.horizon_days)
  }

  const envelope = buildResultEnvelope({
    job,
    result: resultForEnvelope,
    gatewayMode,
    validatedEvidence: v3,
    assetIdentity,
    certificationWarnings: v3.certification_warnings,
    integrationPassed: v3.integration_passed,
    dataQualityCertified: v3.data_quality_certified,
    productionReadinessApproved: v3.production_readiness_approved
  })

  return {
    ok: true,
    state: 'succeeded',
    envelope: redactConsumerEnvelope(envelope),
    validation: v3
  }
}

module.exports = {
  appendAudit,
  finalizeValidatedJob
}
