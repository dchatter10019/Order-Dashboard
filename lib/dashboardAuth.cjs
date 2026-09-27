const crypto = require('crypto')

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(String(value)).digest()
}

function timingSafeEqualString(a, b) {
  return crypto.timingSafeEqual(sha256Buffer(a), sha256Buffer(b))
}

function getDashboardLoginCredentials() {
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
