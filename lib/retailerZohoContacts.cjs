const fs = require('fs')
const path = require('path')

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'retailer-zoho-contacts.json')

function normalizeRetailerKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
}

function loadRetailerZohoContacts(filePath = process.env.RETAILER_ZOHO_CONTACTS_PATH || DEFAULT_PATH) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    const byKey = new Map()
    for (const [name, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry !== 'object') continue
      const email = String(entry.email || '').trim()
      if (!email) continue
      byKey.set(normalizeRetailerKey(name), {
        retailerName: name,
        email,
        zohoContactId: entry.zohoContactId ? String(entry.zohoContactId).trim() : null
      })
    }
    return { filePath, byKey, count: byKey.size }
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { filePath, byKey: new Map(), count: 0, missing: true }
    }
    throw err
  }
}

function getContactForRetailer(retailerName, store = loadRetailerZohoContacts()) {
  return store.byKey.get(normalizeRetailerKey(retailerName)) || null
}

function isValidBillingEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function readContactsJsonFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

function saveRetailerZohoContact(retailerName, { email, zohoContactId } = {}) {
  const name = String(retailerName || '').trim()
  if (!name) throw new Error('Retailer name is required')

  const emailTrim = String(email || '').trim()
  if (!emailTrim) throw new Error('Email is required')
  if (!isValidBillingEmail(emailTrim)) throw new Error('Enter a valid email address')

  const filePath = process.env.RETAILER_ZOHO_CONTACTS_PATH || DEFAULT_PATH
  const data = readContactsJsonFile(filePath)

  const existing = data[name] && typeof data[name] === 'object' ? data[name] : {}
  data[name] = {
    ...existing,
    email: emailTrim,
    updatedAt: new Date().toISOString()
  }
  if (zohoContactId) {
    data[name].zohoContactId = String(zohoContactId).trim()
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')

  return getContactForRetailer(name)
}

module.exports = {
  DEFAULT_PATH,
  normalizeRetailerKey,
  loadRetailerZohoContacts,
  getContactForRetailer,
  isValidBillingEmail,
  saveRetailerZohoContact
}
