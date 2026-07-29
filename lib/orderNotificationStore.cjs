const fs = require('fs')
const path = require('path')

const STORE_PATH =
  process.env.NOTIFIED_ORDERS_PATH ||
  path.join(__dirname, '..', 'data', 'notified-order-keys.json')

const RETENTION_DAYS = 7

/** @type {Record<string, string[]>} */
let store = {}
let loaded = false

function ensureLoaded() {
  if (loaded) return
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))
      store = parsed && typeof parsed === 'object' ? parsed : {}
    }
  } catch {
    store = {}
  }
  loaded = true
  pruneOldDates(false)
}

function persist() {
  const dir = path.dirname(STORE_PATH)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`)
}

function getCutoffYmd() {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)
  return (
    `${cutoff.getFullYear()}-` +
    `${String(cutoff.getMonth() + 1).padStart(2, '0')}-` +
    `${String(cutoff.getDate()).padStart(2, '0')}`
  )
}

function pruneOldDates(shouldPersist = true) {
  ensureLoaded()
  const cutoffYmd = getCutoffYmd()
  let changed = false
  for (const dateYmd of Object.keys(store)) {
    if (dateYmd < cutoffYmd) {
      delete store[dateYmd]
      changed = true
    }
  }
  if (changed && shouldPersist) {
    persist()
  }
}

function getNotifiedKeysForDate(dateYmd) {
  ensureLoaded()
  if (!dateYmd) return new Set()
  const keys = store[dateYmd]
  return new Set(Array.isArray(keys) ? keys.map(String) : [])
}

function isOrderNotified(dateYmd, orderKey) {
  if (!dateYmd || !orderKey) return false
  return getNotifiedKeysForDate(dateYmd).has(String(orderKey))
}

function addNotifiedKeysForDate(dateYmd, orderKeys) {
  ensureLoaded()
  if (!dateYmd || !Array.isArray(orderKeys) || orderKeys.length === 0) {
    return 0
  }

  const existing = getNotifiedKeysForDate(dateYmd)
  const beforeSize = existing.size
  for (const key of orderKeys) {
    const normalized = String(key || '').trim()
    if (normalized) existing.add(normalized)
  }

  if (existing.size === beforeSize) {
    return 0
  }

  store[dateYmd] = Array.from(existing)
  pruneOldDates(false)
  persist()
  return existing.size - beforeSize
}

function getStoreSnapshot() {
  ensureLoaded()
  return { ...store }
}

module.exports = {
  STORE_PATH,
  getNotifiedKeysForDate,
  isOrderNotified,
  addNotifiedKeysForDate,
  getStoreSnapshot
}
