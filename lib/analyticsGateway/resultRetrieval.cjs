const { RESULT_ARTIFACT_DIR } = require('./constants.cjs')
const { hashCanonicalArguments } = require('./canonicalJson.cjs')
const {
  unwrapArtifactPayload,
  validateJobBinding,
  validateHandlerAgainstBinding
} = require('./jobBinding.cjs')

const MAX_ASSET_PAGES = 10
const PAGE_SIZE = 100
const { providerFailure, providerException, validateAssetPage } = require('./providerContract.cjs')

function expectedArtifactBasename(jobId) {
  return `${jobId}.json`
}

function expectedArtifactPath(jobId) {
  return `${RESULT_ARTIFACT_DIR}/${expectedArtifactBasename(jobId)}`
}

function hashArguments(args) {
  return hashCanonicalArguments(args)
}

function parseJsonStrict(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  try {
    const value = JSON.parse(trimmed)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    return value
  } catch {
    return null
  }
}

function parseJsonCandidate(text) {
  return parseJsonStrict(text)
}

function assetBasename(asset) {
  const name = String(asset.filename || asset.name || '')
  if (!name) return ''
  const parts = name.split('/')
  return parts[parts.length - 1]
}

function assetMatchesJobExact(asset, jobId) {
  if (!asset || typeof asset !== 'object') return false
  return assetBasename(asset) === expectedArtifactBasename(jobId)
}

function validateStructuredResult({ job, payload, assetIdentity = null, requireBinding = false }) {
  const unwrapped = unwrapArtifactPayload(payload)
  if (!unwrapped.ok) return unwrapped

  const bindingCheck = validateJobBinding(unwrapped.binding, job, { requireBinding })
  if (!bindingCheck.ok) return bindingCheck

  const handler = unwrapped.handlerResult
  if (!handler || typeof handler !== 'object' || Array.isArray(handler)) {
    return { ok: false, code: 'invalid_result', message: 'Handler result must be a JSON object' }
  }

  const handlerBinding = validateHandlerAgainstBinding(handler, unwrapped.binding)
  if (!handlerBinding.ok) return handlerBinding

  if (requireBinding) {
    if (!unwrapped.wrapped) {
      return { ok: false, code: 'missing_binding', message: 'Wrapped artifact required in live/smoke mode' }
    }
    if (handler.job_id || handler.operation || handler.request_hash) {
      return {
        ok: false,
        code: 'handler_augmentation',
        message: 'Handler must remain pristine Python output without gateway fields'
      }
    }
    if (!assetIdentity?.id || !assetIdentity?.name) {
      return { ok: false, code: 'missing_asset_identity', message: 'Artifact id and filename required' }
    }
    if (assetBasename(assetIdentity) !== expectedArtifactBasename(job.jobId)) {
      return { ok: false, code: 'asset_name_mismatch', message: 'Artifact filename must match job id' }
    }
    if (!assetIdentity.byte_digest || !/^[a-f0-9]{64}$/i.test(assetIdentity.byte_digest)) {
      return { ok: false, code: 'missing_byte_digest', message: 'Artifact byte digest required' }
    }
  }

  return {
    ok: true,
    normalized: handler,
    binding: unwrapped.binding,
    wrapped: unwrapped.wrapped,
    provenance: {
      asset_identity: assetIdentity,
      expected_artifact_path: expectedArtifactPath(job.jobId),
      byte_digest: assetIdentity?.byte_digest || null
    }
  }
}

function selectJobBoundAsset(assets, jobId) {
  if (!Array.isArray(assets)) return null
  const matches = assets.filter((a) => assetMatchesJobExact(a, jobId))
  if (matches.length === 0) return null
  if (matches.length > 1) {
    return { error: 'ambiguous_asset', matches: matches.length }
  }
  return { asset: matches[0] }
}

async function paginateAssets(listPageFn, jobId) {
  const allMatches = []
  let cursor = null
  const cursors = new Set()
  const nonemptyPages = new Set()
  for (let page = 0; page < MAX_ASSET_PAGES; page += 1) {
    let pageResult
    try { pageResult = await listPageFn({ cursor }) } catch (err) { return providerException(err) }
    if (pageResult?.ok === false) return pageResult
    const checked = validateAssetPage(pageResult)
    if (!checked.ok) return checked
    if (pageResult.assets.length && pageResult.assets.every(a => typeof a.asset_id === 'string')) {
      const signature = JSON.stringify(pageResult.assets.map(a => [a.asset_id, a.entry_id ?? null]).sort())
      if (nonemptyPages.has(signature)) return providerFailure('listing_incomplete', 'repeated_asset_page')
      nonemptyPages.add(signature)
    }
    for (const asset of pageResult.assets) {
      if (assetMatchesJobExact(asset, jobId)) allMatches.push(asset)
    }
    cursor = checked.next_cursor
    if (cursor === null) break
    if (cursors.has(cursor)) return providerFailure('listing_incomplete', 'repeated_cursor')
    cursors.add(cursor)
    if (page === MAX_ASSET_PAGES - 1) return providerFailure('listing_incomplete', 'page_cap')
  }
  if (allMatches.length === 0) return null
  if (allMatches.length > 1) {
    return { error: 'ambiguous_asset', matches: allMatches.length }
  }
  return { asset: allMatches[0] }
}

function verifyDownloadMetadata(selectedAsset, downloadMeta) {
  if (!selectedAsset || !downloadMeta) {
    return { ok: false, code: 'metadata_missing', message: 'Download metadata missing' }
  }
  const expectedId = selectedAsset.asset_id || selectedAsset.id
  const metaId = downloadMeta.asset_id || downloadMeta.id
  if (expectedId && metaId && String(expectedId) !== String(metaId)) {
    return { ok: false, code: 'metadata_mismatch', message: 'Download metadata asset_id mismatch' }
  }
  return { ok: true }
}

module.exports = {
  expectedArtifactBasename,
  expectedArtifactPath,
  hashArguments,
  parseJsonStrict,
  parseJsonCandidate,
  assetBasename,
  assetMatchesJobExact,
  validateStructuredResult,
  selectJobBoundAsset,
  paginateAssets,
  verifyDownloadMetadata,
  MAX_ASSET_PAGES,
  PAGE_SIZE
}
