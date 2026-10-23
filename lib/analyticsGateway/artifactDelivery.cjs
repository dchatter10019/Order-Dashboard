const { mapInteractiveEventFromText } = require('./computerTaskSignals.cjs')

/**
 * After Computer task submission, resolve handler JSON ONLY from job-bound assets.
 * Transcript text is used for interactive/timeout signals only — never as result JSON.
 */
async function resolveJobResultFromAssetsOnly({ taskResult, fetchAssetForJob, jobId }) {
  const text =
    taskResult?.text ??
    (taskResult?.content || [])
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('\n')

  const interactive = mapInteractiveEventFromText(text, taskResult?.structuredContent)
  if (interactive) {
    return { ok: false, ...interactive }
  }

  const assetPayload = await fetchAssetForJob(jobId)
  if (assetPayload?.ok === false) return assetPayload
  if (assetPayload?.error === 'ambiguous_asset') {
    return { ok: false, code: 'ambiguous_asset', message: 'Multiple assets matched job id' }
  }
  if (!assetPayload?.payload) {
    return {
      ok: false,
      code: 'awaiting_artifact',
      message: 'Job-specific JSON artifact not available yet'
    }
  }

  return {
    ok: true,
    result: assetPayload.payload,
    assetIdentity: assetPayload.assetIdentity
  }
}

module.exports = {
  resolveJobResultFromAssetsOnly
}
