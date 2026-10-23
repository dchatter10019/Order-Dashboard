const fs = require('fs')
const path = require('path')

const DEFAULT_PATH = path.join(__dirname, '..', '..', 'data', 'analytics-gateway', 'perplexity-oauth.json')

function tokenPath() {
  return process.env.BEVVI_ANALYTICS_GATEWAY_OAUTH_PATH || DEFAULT_PATH
}

function readTokenStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenPath(), 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

function writeTokenStoreAtomic(store) {
  const file = tokenPath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

function getAccessToken() {
  const store = readTokenStore()
  const access = String(store.access_token || '').trim()
  const expiresAt = Number(store.expires_at || 0)
  if (access && Date.now() < expiresAt - 60_000) return { ok: true, accessToken: access }
  if (String(store.refresh_token || '').trim()) {
    return { ok: false, code: 'needs_refresh', message: 'OAuth access token expired; refresh required' }
  }
  return { ok: false, code: 'needs_auth', message: 'Administrator must authorize Computer MCP for the gateway' }
}

module.exports = {
  tokenPath,
  readTokenStore,
  writeTokenStoreAtomic,
  getAccessToken
}
