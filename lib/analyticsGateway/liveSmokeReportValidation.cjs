const crypto = require('crypto')
const fs = require('fs')
const { validateEnvelopeForJob } = require('./resultEnvelope.cjs')
const { validateStructuredResult } = require('./resultRetrieval.cjs')
const { unwrapArtifactPayload } = require('./jobBinding.cjs')
const { validateDataQualityOperationalGuards } = require('./operationalGuards.cjs')
const { readJob } = require('./jobStore.cjs')

function sha256HexBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function loadSmokeArtifactBytesFromEnv() {
  const artifactPath = process.env.BEVVI_ANALYTICS_GATEWAY_SMOKE_ARTIFACT_PATH
  if (!artifactPath || typeof artifactPath !== 'string') {
    return {
      bytes: null,
      status: 'unavailable',
      message: 'Original wrapped artifact bytes not available locally (set BEVVI_ANALYTICS_GATEWAY_SMOKE_ARTIFACT_PATH)'
    }
  }
  try {
    if (!fs.existsSync(artifactPath)) {
      return {
        bytes: null,
        status: 'unavailable',
        message: 'Configured smoke artifact path does not exist'
      }
    }
    return { bytes: fs.readFileSync(artifactPath), status: 'loaded' }
  } catch {
    return { bytes: null, status: 'unavailable', message: 'Could not read configured smoke artifact path' }
  }
}

function validateWrappedArtifactBytes({ job, envelope, artifactBytes }) {
  const assetIdentity = envelope?.provenance?.asset_identity
  if (!assetIdentity?.byte_digest) {
    return {
      ok: false,
      status: 'fail',
      code: 'missing_byte_digest',
      message: 'Stored asset byte_digest required for artifact revalidation'
    }
  }
  const expected = String(assetIdentity.byte_digest).toLowerCase()
  const actual = sha256HexBuffer(artifactBytes)
  if (actual !== expected) {
    return {
      ok: false,
      status: 'fail',
      code: 'digest_mismatch',
      message: 'Artifact SHA-256 does not match stored byte_digest',
      expected_digest: expected,
      actual_digest: actual
    }
  }

  let parsed
  try {
    parsed = JSON.parse(artifactBytes.toString('utf8'))
  } catch {
    return {
      ok: false,
      status: 'fail',
      code: 'invalid_artifact_json',
      message: 'Artifact is not valid JSON'
    }
  }

  const structured = validateStructuredResult({
    job,
    payload: parsed,
    assetIdentity,
    requireBinding: true
  })
  if (!structured.ok) {
    return { ok: false, status: 'fail', ...structured }
  }

  return {
    ok: true,
    status: 'pass',
    byte_digest: actual,
    wrapped: structured.wrapped === true
  }
}

function validateConsumerEnvelope({ job, envelope, asOf }) {
  const envErr = validateEnvelopeForJob(envelope, job)
  const handlerUnwrap = unwrapArtifactPayload(envelope.result)
  const consumerHandler = validateStructuredResult({
    job,
    payload: envelope.result,
    assetIdentity: envelope.provenance?.asset_identity,
    requireBinding: false
  })
  const guards = validateDataQualityOperationalGuards(envelope.result, {
    asOf: asOf ?? job.arguments?.as_of,
    job
  })

  return {
    envelope: envErr ? { ok: false, message: envErr } : { ok: true },
    handler_only_not_wrapped_artifact: {
      ok: handlerUnwrap.wrapped !== true,
      wrapped: handlerUnwrap.wrapped === true,
      message:
        handlerUnwrap.wrapped === true
          ? 'Consumer envelope.result must not be a wrapped artifact'
          : 'Consumer envelope.result is handler-only (expected)'
    },
    consumer_handler: consumerHandler.ok ? { ok: true } : consumerHandler,
    operational_guards: guards
  }
}

function buildLiveSmokeReport({ jobId, envelope, meta, artifactBytes = undefined, asOf }) {
  const job = readJob(jobId)
  const consumer = validateConsumerEnvelope({ job, envelope, asOf })

  let artifactRevalidation
  if (artifactBytes === undefined || artifactBytes === null) {
    artifactRevalidation = {
      ok: null,
      status: 'unavailable',
      message: 'Original wrapped artifact bytes not supplied; binding revalidation not performed'
    }
  } else {
    const buf = Buffer.isBuffer(artifactBytes) ? artifactBytes : Buffer.from(artifactBytes)
    const checked = validateWrappedArtifactBytes({ job, envelope, artifactBytes: buf })
    artifactRevalidation = checked.ok
      ? { ok: true, status: 'pass', byte_digest: checked.byte_digest, wrapped: checked.wrapped }
      : {
          ok: false,
          status: checked.status || 'fail',
          code: checked.code,
          message: checked.message,
          ...(checked.expected_digest && {
            expected_digest: checked.expected_digest,
            actual_digest: checked.actual_digest
          })
        }
  }

  const report = {
    jobId,
    request_id: envelope.request_id,
    operation: envelope.operation,
    arguments: envelope.arguments,
    request_hash: envelope.request_hash,
    identity_validation: {
      ...consumer,
      artifact_revalidation: artifactRevalidation
    },
    provenance: envelope.provenance,
    asset_identity: envelope.provenance?.asset_identity ?? null,
    handler_live_gate_status: envelope.handler_live_gate_status,
    meta,
    unresolved: []
  }

  if (!consumer.envelope.ok) report.unresolved.push(consumer.envelope.message)
  if (!consumer.handler_only_not_wrapped_artifact.ok) {
    report.unresolved.push(consumer.handler_only_not_wrapped_artifact.message)
  }
  if (!consumer.consumer_handler.ok) {
    report.unresolved.push(consumer.consumer_handler.message || consumer.consumer_handler.code)
  }
  if (!consumer.operational_guards.ok) {
    report.unresolved.push(consumer.operational_guards.message || consumer.operational_guards.code)
  }
  if (artifactRevalidation.status === 'fail') {
    report.unresolved.push(artifactRevalidation.message || artifactRevalidation.code)
  }
  if (artifactRevalidation.status === 'unavailable') {
    report.unresolved.push('artifact_revalidation_unavailable')
  }

  return report
}

function liveSmokeReportExitCode(report) {
  return report.unresolved.length > 0 ? 1 : 0
}

module.exports = {
  sha256HexBuffer,
  loadSmokeArtifactBytesFromEnv,
  validateWrappedArtifactBytes,
  validateConsumerEnvelope,
  buildLiveSmokeReport,
  liveSmokeReportExitCode
}
