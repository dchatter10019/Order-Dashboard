const fs = require('fs')
const path = require('path')

const DEFAULT_STORE_PATH = path.join(__dirname, '..', '..', 'data', 'analytics-gateway', 'perplexity-oauth-store.json')
const ISSUER = 'https://www.perplexity.ai/rest/computer/mcp'

function storePath() {
  return process.env.BEVVI_ANALYTICS_GATEWAY_OAUTH_STORE_PATH || DEFAULT_STORE_PATH
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

function writeStoreAtomic(store) {
  const file = storePath()
  const dir = path.dirname(file)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    /* ignore */
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  fs.renameSync(tmp, file)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    /* ignore */
  }
}

function redactStoreForStatus(store) {
  return {
    issuer: store.issuer || store.tokens?.issuer || store.clientInformation?.issuer || null,
    hasClient: Boolean(store.clientInformation?.client_id),
    hasTokens: Boolean(store.tokens?.access_token),
    hasRefreshToken: Boolean(store.tokens?.refresh_token),
    tokenExpiresAt: store.tokens?.expires_at || null,
    updatedAt: store.updatedAt || null,
    pendingAuthorizationUrlSet: Boolean(store.pendingAuthorizationUrl)
  }
}

module.exports = {
  ISSUER,
  storePath,
  readStore,
  writeStoreAtomic,
  redactStoreForStatus
}
