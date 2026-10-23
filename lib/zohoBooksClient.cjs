const axios = require('axios')

let tokenCache = { accessToken: null, expiresAt: 0 }

function zohoConfig() {
  const orgId = String(process.env.ZOHO_BOOKS_ORG_ID || '').trim()
  const clientId = String(process.env.ZOHO_CLIENT_ID || '').trim()
  const clientSecret = String(process.env.ZOHO_CLIENT_SECRET || '').trim()
  const refreshToken = String(process.env.ZOHO_REFRESH_TOKEN || '').trim()
  const accountsUrl = String(process.env.ZOHO_ACCOUNTS_URL || 'https://accounts.zoho.com').replace(/\/$/, '')
  const apiBase = String(process.env.ZOHO_BOOKS_API_BASE || 'https://www.zohoapis.com/books/v3').replace(
    /\/$/,
    ''
  )
  return { orgId, clientId, clientSecret, refreshToken, accountsUrl, apiBase }
}

const REQUIRED_ENV_KEYS = [
  'ZOHO_BOOKS_ORG_ID',
  'ZOHO_CLIENT_ID',
  'ZOHO_CLIENT_SECRET',
  'ZOHO_REFRESH_TOKEN'
]

function getZohoConfigStatus() {
  const missing = REQUIRED_ENV_KEYS.filter((key) => !String(process.env[key] || '').trim())
  return {
    configured: missing.length === 0,
    missing
  }
}

function isZohoConfigured() {
  return getZohoConfigStatus().configured
}

async function getAccessToken() {
  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.accessToken
  }
  const { clientId, clientSecret, refreshToken, accountsUrl } = zohoConfig()
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Zoho Books OAuth is not configured (client id/secret/refresh token).')
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  })

  const { data } = await axios.post(`${accountsUrl}/oauth/v2/token`, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 30_000
  })

  if (!data?.access_token) {
    throw new Error(data?.error || 'Failed to refresh Zoho access token')
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  }
  return tokenCache.accessToken
}

async function zohoRequest(method, path, { params = {}, body = null } = {}) {
  const { orgId, apiBase } = zohoConfig()
  if (!orgId) throw new Error('ZOHO_BOOKS_ORG_ID is not set')

  const token = await getAccessToken()
  const url = `${apiBase}${path.startsWith('/') ? path : `/${path}`}`
  const { data } = await axios({
    method,
    url,
    params: { organization_id: orgId, ...params },
    data: body,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 60_000
  })
  return data
}

async function findContactByName(retailerName) {
  const q = String(retailerName).trim()
  const data = await zohoRequest('GET', '/contacts', { params: { search_text: q } })
  const contacts = data?.contacts || []
  const exact = contacts.find(
    (c) => String(c.contact_name || '').trim().toLowerCase() === String(retailerName).trim().toLowerCase()
  )
  return exact || contacts[0] || null
}

async function createInvoiceForRetailer({
  customerId,
  invoiceDate,
  lineDescription,
  amount,
  reference,
  notes = '',
  terms = ''
}) {
  if (!amount || amount <= 0) {
    throw new Error('Invoice amount must be greater than zero')
  }

  const payload = {
    customer_id: customerId,
    date: invoiceDate,
    reference_number: reference,
    notes: String(notes || '').trim() || undefined,
    terms: String(terms || '').trim() || undefined,
    line_items: [
      {
        name: 'Bevvi platform fees',
        description: lineDescription,
        rate: amount,
        quantity: 1
      }
    ]
  }

  const data = await zohoRequest('POST', '/invoices', { body: payload })
  const invoice = data?.invoice
  if (!invoice?.invoice_id) {
    throw new Error(data?.message || 'Zoho did not return an invoice id')
  }
  return invoice
}

async function emailInvoice(invoiceId, { toEmails, subject, body }) {
  const emails = (toEmails || []).map((e) => String(e).trim()).filter(Boolean)
  if (!emails.length) throw new Error('No recipient email addresses')

  await zohoRequest('POST', `/invoices/${invoiceId}/email`, {
    body: {
      to_mail_ids: emails,
      subject,
      body,
      send_from_org_email_id: true
    }
  })
}

module.exports = {
  zohoConfig,
  getZohoConfigStatus,
  isZohoConfigured,
  getAccessToken,
  findContactByName,
  createInvoiceForRetailer,
  emailInvoice
}
