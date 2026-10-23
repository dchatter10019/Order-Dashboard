function redactOperatorMessage(err) {
  if (!err) return 'Upstream processing failed'
  const code = err.code || 'failed'
  if (['needs_auth', 'awaiting_artifact', 'submission_uncertain', 'forbidden', 'disabled'].includes(code)) {
    return String(err.message || code).slice(0, 240)
  }
  return 'Analytics gateway processing failed'
}

function redactStoredError(error) {
  if (!error || typeof error !== 'object') return error
  return {
    code: error.code || 'failed',
    message: redactOperatorMessage(error)
  }
}

module.exports = {
  redactOperatorMessage,
  redactStoredError
}
