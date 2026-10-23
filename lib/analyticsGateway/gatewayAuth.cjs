const crypto = require('crypto')

function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

function parseClientsRegistry(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, code: 'gateway_misconfigured', message: 'Invalid BEVVI_ANALYTICS_GATEWAY_CLIENTS_JSON' }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, code: 'gateway_misconfigured', message: 'Clients registry must be a JSON object' }
  }

  const map = new Map()
  const hashOwners = new Map()
  const nowMs = Date.now()

  for (const [clientId, entry] of Object.entries(parsed)) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, code: 'gateway_misconfigured', message: `Invalid client entry: ${clientId}` }
    }
    const hash = String(entry.tokenSha256 || entry.tokenHash || '').trim().toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      return { ok: false, code: 'gateway_misconfigured', message: `Invalid token hash for client ${clientId}` }
    }
    if (hashOwners.has(hash)) {
      return {
        ok: false,
        code: 'gateway_misconfigured',
        message: `Duplicate token identity for clients ${hashOwners.get(hash)} and ${clientId}`
      }
    }
    hashOwners.set(hash, clientId)

    if (entry.revoked === true) {
      continue
    }
    if (entry.expiresAt) {
      const exp = Date.parse(entry.expiresAt)
      if (Number.isNaN(exp) || exp <= nowMs) {
        continue
      }
    }

    if (!Array.isArray(entry.scopes) || !entry.scopes.length) {
      return {
        ok: false,
        code: 'gateway_misconfigured',
        message: `Explicit scopes array required for client ${clientId}`
      }
    }
    const scopes = entry.scopes.map(String)
    let allowedCustomers = null
    let companyWideForbidden = false
    if (Object.prototype.hasOwnProperty.call(entry, 'allowedCustomers')) {
      if (!Array.isArray(entry.allowedCustomers)) {
        return {
          ok: false,
          code: 'gateway_misconfigured',
          message: `allowedCustomers must be an array for client ${clientId}`
        }
      }
      if (entry.allowedCustomers.length === 0) {
        companyWideForbidden = true
        allowedCustomers = []
      } else {
        allowedCustomers = entry.allowedCustomers.map(String)
        companyWideForbidden = true
      }
    }

    map.set(String(clientId), {
      hash,
      scopes,
      allowedCustomers,
      companyWideForbidden,
      expiresAt: entry.expiresAt || null
    })
  }

  if (!map.size) {
    return {
      ok: false,
      code: 'gateway_misconfigured',
      message: 'No active gateway clients in registry (all revoked/expired/invalid)'
    }
  }
  return { ok: true, map }
}

function loadClientVerifiers() {
  const raw = String(process.env.BEVVI_ANALYTICS_GATEWAY_CLIENTS_JSON || '').trim()
  if (raw) {
    const parsed = parseClientsRegistry(raw)
    if (!parsed.ok) throw new Error(parsed.message)
    return parsed.map
  }

  const single = String(process.env.BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN || '').trim()
  if (single) {
    return new Map([
      [
        'default',
        {
          hash: sha256Hex(single),
          scopes: ['analytics:read', 'analytics:submit'],
          allowedCustomers: null,
          companyWideForbidden: false,
          expiresAt: null
        }
      ]
    ])
  }
  return new Map()
}

function authenticateGatewayRequest(authHeader, verifiers = loadClientVerifiers()) {
  if (!verifiers.size) {
    return { ok: false, code: 'gateway_misconfigured', message: 'No gateway client credentials configured' }
  }
  const header = String(authHeader || '')
  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    return { ok: false, code: 'unauthorized', message: 'Missing Bearer token' }
  }
  const token = match[1].trim()
  const tokenHash = sha256Hex(token)
  for (const [clientId, entry] of verifiers.entries()) {
    try {
      const a = Buffer.from(tokenHash, 'hex')
      const b = Buffer.from(entry.hash, 'hex')
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        return {
          ok: true,
          clientId,
          scopes: entry.scopes,
          allowedCustomers: entry.allowedCustomers,
          companyWideForbidden: entry.companyWideForbidden
        }
      }
    } catch {
      continue
    }
  }
  return { ok: false, code: 'unauthorized', message: 'Invalid or expired client token' }
}

function enforceCustomerScope(clientMeta, operation, args) {
  const restrictedCustomers = clientMeta?.allowedCustomers
  if (!clientMeta?.companyWideForbidden || restrictedCustomers === null) {
    return { ok: true }
  }
  if (operation === 'bevvi_planning_forecast' && !args.customer) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'Company-wide forecast not permitted for this client identity'
    }
  }
  const customer = args.customer ? String(args.customer) : null
  if (customer && !restrictedCustomers.includes(customer)) {
    return { ok: false, code: 'forbidden', message: 'Customer filter not authorized' }
  }
  if (Array.isArray(args.customers)) {
    for (const c of args.customers) {
      if (!restrictedCustomers.includes(String(c))) {
        return { ok: false, code: 'forbidden', message: 'Customer filter not authorized' }
      }
    }
  }
  return { ok: true }
}

module.exports = {
  sha256Hex,
  parseClientsRegistry,
  loadClientVerifiers,
  authenticateGatewayRequest,
  enforceCustomerScope
}
