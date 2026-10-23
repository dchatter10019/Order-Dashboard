import crypto from 'crypto'
import { createRequire } from 'module'

const requireStore = createRequire(import.meta.url)

const { ISSUER, readStore, writeStoreAtomic } = requireStore('./perplexityOAuthStore.cjs')

const REDIRECT_PATH = '/analytics/admin/oauth/callback'

export function getOAuthRedirectUrl() {
  const explicit = String(process.env.BEVVI_ANALYTICS_GATEWAY_OAUTH_REDIRECT_URL || '').trim()
  if (explicit) {
    return new URL(explicit)
  }
  const host = process.env.BEVVI_ANALYTICS_GATEWAY_HOST || '127.0.0.1'
  const port = process.env.BEVVI_ANALYTICS_GATEWAY_PORT || '8791'
  return new URL(`http://${host}:${port}${REDIRECT_PATH}`)
}

export class BevviPerplexityOAuthProvider {
  get redirectUrl() {
    return getOAuthRedirectUrl()
  }

  get clientMetadata() {
    return {
      client_name: 'Bevvi Analytics Gateway (administrator)',
      redirect_uris: [String(this.redirectUrl)],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post'
    }
  }

  clientMetadataUrl = undefined

  clientInformation() {
    const store = readStore()
    return store.clientInformation
  }

  async saveClientInformation(clientInformation) {
    const store = readStore()
    store.clientInformation = { ...clientInformation, issuer: ISSUER }
    store.updatedAt = new Date().toISOString()
    writeStoreAtomic(store)
  }

  tokens() {
    const store = readStore()
    if (!store.tokens) return undefined
    return store.tokens
  }

  async saveTokens(tokens) {
    const store = readStore()
    const expiresIn = Number(tokens.expires_in || 3600)
    store.tokens = {
      ...tokens,
      issuer: ISSUER,
      expires_at: Date.now() + expiresIn * 1000
    }
    store.updatedAt = new Date().toISOString()
    store.issuer = ISSUER
    delete store.codeVerifier
    delete store.oauthState
    delete store.pendingAuthorizationUrl
    writeStoreAtomic(store)
  }

  async redirectToAuthorization(authorizationUrl) {
    storePendingAuthUrl(authorizationUrl)
    // Never log tokens; authorization URL is safe to surface to administrator console.
    console.log(`[analytics-gateway] Administrator OAuth: open this URL in a browser:\n${authorizationUrl}`)
  }

  async saveCodeVerifier(codeVerifier) {
    const store = readStore()
    store.codeVerifier = codeVerifier
    store.updatedAt = new Date().toISOString()
    writeStoreAtomic(store)
  }

  codeVerifier() {
    const store = readStore()
    return store.codeVerifier || ''
  }

  state() {
    const value = crypto.randomBytes(16).toString('hex')
    const store = readStore()
    store.oauthState = value
    store.updatedAt = new Date().toISOString()
    writeStoreAtomic(store)
    return value
  }
}

function storePendingAuthUrl(url) {
  const store = readStore()
  store.pendingAuthorizationUrl = String(url)
  store.updatedAt = new Date().toISOString()
  writeStoreAtomic(store)
}

export function consumeOAuthCallbackState(receivedState) {
  const store = readStore()
  const expected = store.oauthState
  if (!expected || expected !== receivedState) {
    throw new Error('OAuth state mismatch')
  }
  return store
}

export function getOAuthAdminStatus() {
  const store = readStore()
  const { redactStoreForStatus } = requireStore('./perplexityOAuthStore.cjs')
  return {
    ...redactStoreForStatus(store),
    redirectUrl: String(getOAuthRedirectUrl()),
    pendingAuthorizationUrl: store.pendingAuthorizationUrl ? '(set — open in browser)' : null
  }
}
