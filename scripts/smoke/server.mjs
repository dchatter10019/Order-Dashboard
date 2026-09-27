/**
 * Server-side smoke tests: shared lib logic + in-process HTTP for auth routes.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from './runner.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const require = createRequire(import.meta.url)
const { pass, fail, section, finish } = createRunner('server')

async function withEnv(vars, fn) {
  const saved = {}
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key]
    const value = vars[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  try {
    return await fn()
  } finally {
    for (const key of Object.keys(vars)) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  }
}

function reloadDashboardAuth() {
  const resolved = require.resolve('../../lib/dashboardAuth.cjs')
  delete require.cache[resolved]
  return require('../../lib/dashboardAuth.cjs')
}

function reloadOrderDateRange() {
  const resolved = require.resolve('../../lib/orderDateRange.cjs')
  delete require.cache[resolved]
  return require('../../lib/orderDateRange.cjs')
}

section('Auth credentials (lib/dashboardAuth.cjs)')
await withEnv(
  {
    DASHBOARD_LOGIN_USERNAME: 'smoke_test_user',
    DASHBOARD_LOGIN_PASSWORD: 'smoke_test_pass'
  },
  () => {
    const auth = reloadDashboardAuth()
    if (auth.verifyDashboardLogin('smoke_test_user', 'smoke_test_pass')) {
      pass('verifyDashboardLogin accepts configured credentials')
    } else {
      fail('verifyDashboardLogin accepts configured credentials')
    }
    if (!auth.verifyDashboardLogin('smoke_test_user', 'wrong')) {
      pass('verifyDashboardLogin rejects wrong password')
    } else {
      fail('verifyDashboardLogin rejects wrong password')
    }
  }
)

await withEnv(
  {
    DASHBOARD_LOGIN_USERNAME: undefined,
    DASHBOARD_LOGIN_PASSWORD: undefined
  },
  () => {
    const auth = reloadDashboardAuth()
    if (!auth.verifyDashboardLogin('any', 'any')) {
      pass('verifyDashboardLogin false when env not configured')
    } else {
      fail('verifyDashboardLogin when env not configured')
    }
  }
)

section('Order date range (lib/orderDateRange.cjs)')
{
  const { validateOrderDateRange, MAX_ORDER_DATE_RANGE_DAYS } = reloadOrderDateRange()
  if (validateOrderDateRange('2026-09-01', '2026-09-26') === null) {
    pass('valid 26-day range')
  } else {
    fail('valid 26-day range')
  }
  if (validateOrderDateRange('2026-09-01', '2026-09-01') === null) {
    pass('single-day range')
  } else {
    fail('single-day range')
  }
  if (validateOrderDateRange('2026-09-10', '2026-09-01') != null) {
    pass('rejects start after end')
  } else {
    fail('rejects start after end')
  }
  if (validateOrderDateRange('not-a-date', '2026-09-01') != null) {
    pass('rejects invalid date format')
  } else {
    fail('rejects invalid date format')
  }
  const start = '2026-09-01'
  const end = '2026-10-02'
  if (validateOrderDateRange(start, end) != null) {
    pass(`rejects range over ${MAX_ORDER_DATE_RANGE_DAYS} days`)
  } else {
    fail(`rejects range over ${MAX_ORDER_DATE_RANGE_DAYS} days`)
  }
}

section('Manual orders & bulk upload (lib/*.cjs)')
try {
  const { deriveManualOrderDeliveryFee } = require('../../lib/manualOrderDeliveryInference.cjs')
  const inferred = deriveManualOrderDeliveryFee(
    {
      corpOrderNum: 'BEV-MAN-TEST',
      isManualOrder: true,
      orderTotal: 129.93,
      taxes: 9.62,
      shippingCharges: 0,
      serviceCharge: 6.5,
      serviceChargeTax: 0.57,
      tipAmount: 3.25,
      deliveryCharge: 0,
      products: [{ quantity: 1, price: 64.99 }]
    },
    null
  )
  if (Math.abs(inferred - 45) < 0.02) pass('manual order delivery inference')
  else fail('manual order delivery inference', `expected 45, got ${inferred}`)
} catch (e) {
  fail('manualOrderDeliveryInference.cjs', e.message)
}

try {
  const { normalizeZip, parseUsAddressFallback } = require('../../lib/manualOrderBulkSpreadsheet.cjs')
  if (normalizeZip(123) === '00123' && normalizeZip('90210') === '90210') {
    pass('bulk spreadsheet normalizeZip')
  } else {
    fail('bulk spreadsheet normalizeZip')
  }
  const addr = parseUsAddressFallback('123 Main St, Austin, TX, 78701')
  if (addr?.city === 'Austin' && addr?.state === 'TX') {
    pass('bulk spreadsheet parseUsAddressFallback')
  } else {
    fail('bulk spreadsheet parseUsAddressFallback', JSON.stringify(addr))
  }
} catch (e) {
  fail('manualOrderBulkSpreadsheet.cjs', e.message)
}

section('Auth HTTP route (in-process Express)')
await withEnv(
  {
    DASHBOARD_LOGIN_USERNAME: 'smoke_http_user',
    DASHBOARD_LOGIN_PASSWORD: 'smoke_http_pass'
  },
  async () => {
    const express = require('express')
    const auth = reloadDashboardAuth()
    const app = express()
    app.use(express.json())
    app.post('/api/auth/login', auth.createAuthLoginHandler())

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    const { port } = server.address()
    const base = `http://127.0.0.1:${port}`

    try {
      const missing = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'smoke_http_user' })
      })
      if (missing.status === 400) pass('POST /api/auth/login 400 without password')
      else fail('POST /api/auth/login 400', String(missing.status))

      const bad = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'smoke_http_user', password: 'wrong' })
      })
      if (bad.status === 401) pass('POST /api/auth/login 401 bad credentials')
      else fail('POST /api/auth/login 401', String(bad.status))

      const ok = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'smoke_http_user', password: 'smoke_http_pass' })
      })
      const body = await ok.json()
      if (ok.status === 200 && /^bevvi_auth_[a-f0-9]+$/.test(body.token || '')) {
        pass('POST /api/auth/login 200 returns token')
      } else {
        fail('POST /api/auth/login 200', JSON.stringify(body))
      }
    } catch (e) {
      fail('in-process auth HTTP', e.message)
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
    }
  }
)

section('Server wiring (static)')
const serverSrc = readFileSync(path.join(root, 'server.js'), 'utf8')
if (serverSrc.includes("createAuthLoginHandler") && serverSrc.includes('/api/health')) {
  pass('server.js uses shared auth handler and exposes /api/health')
} else {
  fail('server.js wiring')
}

const apiBase = process.env.SMOKE_API_BASE_URL || ''
if (apiBase) {
  section(`Live API (${apiBase})`)
  try {
    const health = await fetch(`${apiBase.replace(/\/$/, '')}/api/health`)
    if (health.ok) pass('GET /api/health')
    else fail('GET /api/health', String(health.status))

    const statusRes = await fetch(`${apiBase.replace(/\/$/, '')}/api/products/status`)
    if (statusRes.ok) pass('GET /api/products/status')
    else fail('GET /api/products/status', String(statusRes.status))

    const badLogin = await fetch(`${apiBase.replace(/\/$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'invalid', password: 'invalid' })
    })
    if (badLogin.status === 401 || badLogin.status === 503) {
      pass('POST /api/auth/login rejects invalid or unconfigured login')
    } else {
      fail('POST /api/auth/login', `expected 401 or 503, got ${badLogin.status}`)
    }
  } catch (e) {
    fail('live API checks', e.message)
  }
}

const failures = finish()
const ranAsMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (ranAsMain) {
  process.exit(failures > 0 ? 1 : 0)
}
export default failures
