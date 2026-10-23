const crypto = require('crypto')
const { hashCanonicalArguments } = require('./canonicalJson.cjs')
const { ENVELOPE_SCHEMA_VERSION } = require('./constants.cjs')

function buildResultEnvelope({
  job,
  result,
  error = null,
  gatewayMode = 'unknown',
  validatedEvidence = null,
  assetIdentity = null,
  certificationWarnings = [],
  integrationPassed = false,
  dataQualityCertified = false,
  productionReadinessApproved = false
}) {
  const generatedAt = new Date().toISOString()
  const handlerGate = validatedEvidence?.handler_live_gate_status || 'OFF'

  return {
    schema_version: ENVELOPE_SCHEMA_VERSION,
    job_id: job.jobId,
    request_id: job.jobId,
    operation: job.operation,
    arguments: job.arguments,
    request_hash: job.requestHash,
    provenance: {
      generated_at: generatedAt,
      handler_generated_at_utc: validatedEvidence?.generated_at_utc ?? null,
      handler_source_hash: validatedEvidence?.source_hash ?? null,
      asset_identity: assetIdentity
        ? {
            id: assetIdentity.id ?? null,
            entry_id: assetIdentity.entry_id ?? null,
            name: assetIdentity.name ?? null,
            version: assetIdentity.version ?? null,
            byte_digest: assetIdentity.byte_digest ?? null
          }
        : null
    },
    gateway_mode: gatewayMode,
    handler_live_gate_status: handlerGate,
    review_only: true,
    production_ready: false,
    writes_performed: false,
    integration_test_passed: integrationPassed,
    data_quality_certified: dataQualityCertified,
    production_readiness_approved: productionReadinessApproved,
    certification_warnings: certificationWarnings,
    result: error ? null : result,
    error: error
      ? {
          code: error.code || 'failed',
          message: error.message || 'Analytics job failed'
        }
      : null
  }
}

function validateEnvelopeForJob(envelope, job) {
  if (!envelope || typeof envelope !== 'object') return 'Missing envelope'
  if (envelope.job_id !== job.jobId) return 'Job id mismatch'
  if (envelope.request_hash !== job.requestHash) return 'Request hash mismatch'
  if (envelope.operation !== job.operation) return 'Operation mismatch'
  const argsHash = hashCanonicalArguments(job.arguments)
  const envArgsHash = hashCanonicalArguments(envelope.arguments)
  if (argsHash !== envArgsHash) return 'Arguments mismatch'
  if (envelope.live_gate_status) return 'Envelope must not expose unchecked live_gate_status'
  return null
}

function redactConsumerEnvelope(envelope) {
  if (!envelope) return envelope
  const clone = JSON.parse(JSON.stringify(envelope))
  if (clone.provenance?.asset_identity) {
    delete clone.provenance.asset_identity.download_url
    delete clone.provenance.asset_identity.url
  }
  return clone
}

module.exports = {
  buildResultEnvelope,
  validateEnvelopeForJob,
  redactConsumerEnvelope
}
