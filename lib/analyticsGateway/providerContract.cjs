const PROVIDER_DELIVERY_ERRORS = new Set([
  'provider_request_failed', 'provider_transport_error', 'invalid_provider_response',
  'listing_incomplete'
])

function providerFailure(code, reason = null) {
  const messages = {
    provider_request_failed: 'Provider rejected the asset metadata request',
    provider_transport_error: 'Provider asset metadata transport failed',
    invalid_provider_response: 'Provider asset metadata response violates the captured contract',
    listing_incomplete: 'Asset listing is incomplete; absence and uniqueness are not established',
    needs_auth: 'Existing provider authorization requires administrator attention'
  }
  return { ok: false, code, error: code, message: messages[code] || 'Provider check failed', ...(reason ? { reason } : {}) }
}

function providerException(err) {
  return providerFailure(
    err?.status === 401 || err?.status === 403 || err?.code === 401 ||
    err?.name === 'UnauthorizedError' ? 'needs_auth' : 'provider_transport_error'
  )
}

function decodeProviderResult(result) {
  if (!result || result.isError) {
    const code = result?.code ?? result?.structuredContent?.code
    return providerFailure(code === 'needs_auth' || code === 'unauthorized' ? 'needs_auth' : 'provider_request_failed')
  }
  let value
  try {
    value = result.structuredContent ?? JSON.parse((result.content || [])
      .filter(p => p.type === 'text').map(p => p.text).join('\n'))
  } catch { return providerFailure('invalid_provider_response', 'non_json') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return providerFailure('invalid_provider_response', 'object_required')
  }
  return { ok: true, value }
}

function validateAssetPage(page) {
  if (!page || typeof page !== 'object' || !Array.isArray(page.assets) ||
      page.assets.some(a => !a || typeof a !== 'object' || Array.isArray(a)) ||
      !Object.hasOwn(page, 'next_cursor') ||
      !(page.next_cursor === null || (typeof page.next_cursor === 'string' && page.next_cursor.length > 0))) {
    return providerFailure('invalid_provider_response', 'assets_and_explicit_next_cursor_required')
  }
  return { ok: true, assets: page.assets, next_cursor: page.next_cursor }
}

module.exports = { PROVIDER_DELIVERY_ERRORS, providerFailure, providerException, decodeProviderResult, validateAssetPage }
