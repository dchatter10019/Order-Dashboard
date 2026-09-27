/**
 * Client-side smoke tests: React app utils, routing, and production build.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRunner } from './runner.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const { pass, fail, section, finish } = createRunner('client')

section('Production build')
const build = spawnSync('npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})
if (build.status === 0) pass('vite build')
else fail('vite build', `exit code ${build.status ?? 'unknown'}`)

section('Login UI (static)')
const loginPath = path.join(root, 'src/components/Login.jsx')
if (existsSync(loginPath)) {
  const loginSrc = readFileSync(loginPath, 'utf8')
  if (!/Bevvi_123#|Bevvi_User/.test(loginSrc)) pass('no hardcoded demo credentials')
  else fail('no hardcoded demo credentials in Login.jsx')
  if (loginSrc.includes('/api/auth/login')) pass('Login uses /api/auth/login')
  else fail('Login.jsx should call /api/auth/login')
} else {
  fail('Login.jsx missing')
}

section('Dashboard routing (src/constants/dashboardRoutes.js)')
try {
  const { tabIdFromPathname, pathFromTabId, TAB_TO_PATH } = await import(
    '../../src/constants/dashboardRoutes.js'
  )
  if (tabIdFromPathname('/orders') === 'orders' && tabIdFromPathname('/ai-assistant') === 'ai-assistant') {
    pass('tabIdFromPathname for tab URLs')
  } else {
    fail('tabIdFromPathname')
  }
  if (pathFromTabId('products') === '/products' && TAB_TO_PATH.orders === '/orders') {
    pass('pathFromTabId and TAB_TO_PATH')
  } else {
    fail('pathFromTabId')
  }
  if (tabIdFromPathname('/dashboard') === 'orders') {
    pass('legacy /dashboard maps to orders')
  } else {
    fail('legacy /dashboard')
  }
} catch (e) {
  fail('dashboardRoutes.js', e.message)
}

section('Orders list URL state (src/utils/ordersDashboardUrlState.js)')
try {
  const {
    parseOrdersDashboardSearchParams,
    serializeOrdersDashboardSearchParams,
    DEFAULT_ORDER_STATUS_FILTER
  } = await import('../../src/utils/ordersDashboardUrlState.js')

  const parsed = parseOrdersDashboardSearchParams(
    new URLSearchParams('start=2026-09-01&end=2026-09-26&q=SDL&status=delivered,pending')
  )
  if (
    parsed.dateRange?.startDate === '2026-09-01' &&
    parsed.searchTerm === 'SDL' &&
    parsed.statusFilter?.includes('delivered')
  ) {
    pass('parse filters from query string')
  } else {
    fail('parse filters', JSON.stringify(parsed))
  }

  const serialized = serializeOrdersDashboardSearchParams({
    dateRange: { startDate: '2026-09-01', endDate: '2026-09-26' },
    searchTerm: 'SDL',
    statusFilter: [...DEFAULT_ORDER_STATUS_FILTER],
    deliveryFilter: []
  })
  if (serialized.get('q') === 'SDL' && serialized.get('start') === '2026-09-01') {
    pass('serialize filters to query string')
  } else {
    fail('serialize filters', serialized.toString())
  }
} catch (e) {
  fail('ordersDashboardUrlState.js', e.message)
}

section('Order display totals (src/utils/orderTotals.js)')
try {
  const { getOrderGrandTotal } = await import('../../src/utils/orderTotals.js')
  const fromComponents = getOrderGrandTotal({
    revenue: 100,
    tax: 10,
    tip: 5,
    shippingFee: 0,
    deliveryFee: 25,
    serviceCharge: 0,
    serviceChargeTax: 0,
    giftNoteCharge: 0,
    promoDiscAmt: 0
  })
  if (Math.abs(fromComponents - 140) < 0.01) pass('grand total from line items')
  else fail('grand total from line items', String(fromComponents))

  const fromTotalField = getOrderGrandTotal({ total: 99.5, revenue: 1 })
  if (Math.abs(fromTotalField - 99.5) < 0.01) pass('prefers explicit total field')
  else fail('prefers explicit total field', String(fromTotalField))
} catch (e) {
  fail('orderTotals.js', e.message)
}

section('AI assistant helpers (src/utils/aiQueryHelpers.js)')
try {
  const { isAggregateRevenueQuery, looksLikeRevenueByCustomerQuery } = await import(
    '../../src/utils/aiQueryHelpers.js'
  )
  if (
    isAggregateRevenueQuery('What is my total revenue this month?') &&
    !isAggregateRevenueQuery('revenue for Sendoso')
  ) {
    pass('isAggregateRevenueQuery')
  } else {
    fail('isAggregateRevenueQuery')
  }
  if (looksLikeRevenueByCustomerQuery('revenue for Sendoso last week')) {
    pass('looksLikeRevenueByCustomerQuery')
  } else {
    fail('looksLikeRevenueByCustomerQuery')
  }
} catch (e) {
  fail('aiQueryHelpers.js', e.message)
}

section('App shell (static)')
const appSrc = readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
if (appSrc.includes('/orders/:orderNumber') && appSrc.includes('/ai-assistant')) {
  pass('App.jsx order detail and AI routes')
} else {
  fail('App.jsx routing')
}

const distIndex = path.join(root, 'dist/index.html')
if (existsSync(distIndex)) {
  const html = readFileSync(distIndex, 'utf8')
  if (html.includes('script') && html.includes('assets/')) pass('dist/index.html references bundles')
  else fail('dist/index.html bundle refs')
} else {
  fail('dist/index.html missing after build')
}

const failures = finish()
const ranAsMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
if (ranAsMain) {
  process.exit(failures > 0 ? 1 : 0)
}
export default failures
