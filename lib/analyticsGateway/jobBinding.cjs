const { hashCanonicalArguments } = require('./canonicalJson.cjs')

const BINDING_KEY = 'gateway_job_binding'
const HANDLER_KEY = 'handler_result'
const BINDING_SCHEMA = 'gateway_job_binding_v1'

function buildJobBinding(job) {
  return {
    schema_version: BINDING_SCHEMA,
    job_id: job.jobId,
    operation: job.operation,
    arguments: job.arguments,
    request_hash: job.requestHash
  }
}

function wrapHandlerArtifact(job, handlerResult) {
  return {
    [HANDLER_KEY]: handlerResult,
    [BINDING_KEY]: buildJobBinding(job)
  }
}

function unwrapArtifactPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'invalid_result', message: 'Artifact must be a JSON object' }
  }
  if (raw[HANDLER_KEY] && raw[BINDING_KEY]) {
    return {
      ok: true,
      handlerResult: raw[HANDLER_KEY],
      binding: raw[BINDING_KEY],
      wrapped: true
    }
  }
  return { ok: true, handlerResult: raw, binding: null, wrapped: false }
}

function validateJobBinding(binding, job, { requireBinding = false } = {}) {
  if (!binding) {
    if (requireBinding) {
      return { ok: false, code: 'missing_binding', message: 'gateway_job_binding required in live/smoke artifacts' }
    }
    return { ok: true, legacy: true }
  }
  if (binding.schema_version !== BINDING_SCHEMA) {
    return { ok: false, code: 'binding_schema', message: 'Unsupported gateway_job_binding schema' }
  }
  if (binding.job_id !== job.jobId) {
    return { ok: false, code: 'job_mismatch', message: 'Binding job_id mismatch' }
  }
  if (binding.operation !== job.operation) {
    return { ok: false, code: 'operation_mismatch', message: 'Binding operation mismatch' }
  }
  if (binding.request_hash !== job.requestHash) {
    return { ok: false, code: 'request_hash_mismatch', message: 'Binding request_hash mismatch' }
  }
  const argsHash = hashCanonicalArguments(job.arguments)
  const bindingHash = hashCanonicalArguments(binding.arguments)
  if (argsHash !== bindingHash) {
    return { ok: false, code: 'arguments_mismatch', message: 'Binding arguments mismatch' }
  }
  return { ok: true, legacy: false }
}

function validateHandlerAgainstBinding(handler, binding) {
  if (!binding || !handler || typeof handler !== 'object') return { ok: true }
  if (handler.arguments != null) {
    const handlerHash = hashCanonicalArguments(handler.arguments)
    const bindingHash = hashCanonicalArguments(binding.arguments)
    if (handlerHash !== bindingHash) {
      return {
        ok: false,
        code: 'arguments_mismatch',
        message: 'handler_result.arguments contradict gateway_job_binding'
      }
    }
  }
  if (handler.job_id && handler.job_id !== binding.job_id) {
    return { ok: false, code: 'job_mismatch', message: 'handler_result.job_id contradicts binding' }
  }
  if (handler.operation && handler.operation !== binding.operation) {
    return { ok: false, code: 'operation_mismatch', message: 'handler_result.operation contradicts binding' }
  }
  return { ok: true }
}

module.exports = {
  BINDING_KEY,
  HANDLER_KEY,
  BINDING_SCHEMA,
  buildJobBinding,
  wrapHandlerArtifact,
  unwrapArtifactPayload,
  validateJobBinding,
  validateHandlerAgainstBinding
}
