const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

let hydratedLoginEnvFromFile = false

/** If process env is missing login vars, read DASHBOARD_LOGIN_* from project .env (works even when dotenv override is off). */
function hydrateDashboardLoginFromEnvFile() {
  if (hydratedLoginEnvFromFile) return
  hydratedLoginEnvFromFile = true

  const hasUser = String(process.env.DASHBOARD_LOGIN_USERNAME || '').trim()
  const hasPass = String(process.env.DASHBOARD_LOGIN_PASSWORD || '').trim()
  if (hasUser && hasPass) return

  const envPath = path.join(__dirname, '..', '.env')
  try {
    const content = fs.readFileSync(envPath, 'utf8')
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      if (key !== 'DASHBOARD_LOGIN_USERNAME' && key !== 'DASHBOARD_LOGIN_PASSWORD') continue
      if (String(process.env[key] || '').trim()) continue
      let value = trimmed.slice(eq + 1).trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('⚠️ Could not read .env for dashboard login:', err.message)
    }
  }
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(String(value)).digest()
}

function timingSafeEqualString(a, b) {
  return crypto.timingSafeEqual(sha256Buffer(a), sha256Buffer(b))
}

function getDashboardLoginCredentials() {
  hydrateDashboardLoginFromEnvFile()
  return {
    username: String(process.env.DASHBOARD_LOGIN_USERNAME || '').trim(),
    password: String(process.env.DASHBOARD_LOGIN_PASSWORD || '').trim()
  }
}

function verifyDashboardLogin(inputUsername, inputPassword) {
  const { username, password } = getDashboardLoginCredentials()
  if (!username || !password) return false
  try {
    return (
      timingSafeEqualString(inputUsername, username) &&
      timingSafeEqualString(inputPassword, password)
    )
  } catch {
    return false
  }
}

function createAuthLoginHandler() {
  return (req, res) => {
    const { username, password } = req.body || {}
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' })
    }

    const { username: configuredUser, password: configuredPass } = getDashboardLoginCredentials()
    if (!configuredUser || !configuredPass) {
      return res.status(503).json({ error: 'Login is not configured on the server' })
    }

    if (!verifyDashboardLogin(username, password)) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    const token = `bevvi_auth_${crypto.randomBytes(32).toString('hex')}`
    return res.json({ token })
  }
}

module.exports = {
  getDashboardLoginCredentials,
  verifyDashboardLogin,
  createAuthLoginHandler
}
