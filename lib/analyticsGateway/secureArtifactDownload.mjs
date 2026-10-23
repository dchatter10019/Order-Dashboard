import crypto from 'crypto'
import dns from 'dns/promises'
import net from 'net'
import https from 'node:https'
import { Readable } from 'node:stream'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_REDIRECTS = 3
const DEFAULT_TIMEOUT_MS = 15_000

function parseAllowedHostsEnv() {
  const raw = String(process.env.BEVVI_ANALYTICS_GATEWAY_ARTIFACT_DOWNLOAD_ALLOW_HOSTS || '').trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean)
  )
}

function normalizeIp(ip) {
  if (net.isIPv6(ip) && ip.toLowerCase().startsWith('::ffff:')) {
    return ip.slice(7)
  }
  return ip
}

function isPrivateIp(ip) {
  const normalized = normalizeIp(ip)
  if (net.isIPv4(normalized)) {
    const parts = normalized.split('.').map(Number)
    if (parts[0] === 10) return true
    if (parts[0] === 127) return true
    if (parts[0] === 169 && parts[1] === 254) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    if (parts[0] === 0) return true
    return false
  }
  if (net.isIPv6(normalized)) {
    const n = normalized.toLowerCase()
    return n === '::1' || n.startsWith('fc') || n.startsWith('fd') || n.startsWith('fe80')
  }
  return true
}

async function resolveHostAddresses(hostname) {
  if (net.isIP(hostname)) return [normalizeIp(hostname)]
  const records = await dns.lookup(hostname, { all: true, verbatim: true })
  return records.map((r) => normalizeIp(r.address))
}

function parseStrictJson(text) {
  if (typeof text !== 'string') {
    return { ok: false, code: 'invalid_json', message: 'Artifact body must be text' }
  }
  const trimmed = text.trim()
  try {
    const value = JSON.parse(trimmed)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, code: 'invalid_json', message: 'Artifact JSON must be an object' }
    }
    return { ok: true, payload: value, rawText: trimmed }
  } catch {
    return { ok: false, code: 'invalid_json', message: 'Artifact body is not strict JSON' }
  }
}

function nodeResponseToWeb(res) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(res.headers)) {
    if (value != null) headers.append(key, Array.isArray(value) ? value.join(', ') : value)
  }
  const body = Readable.toWeb(res)
  return {
    status: res.statusCode || 0,
    headers,
    body,
    ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300
  }
}

export function createSecureArtifactDownloader(options = {}) {
  const allowedHosts = options.allowedHosts || parseAllowedHostsEnv()
  const fetchImpl = options.fetchImpl || null
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const trustAllowedHostsWithoutDns = options.trustAllowedHostsWithoutDns === true

  async function assertSafeUrl(urlString) {
    let url
    try {
      url = new URL(urlString)
    } catch {
      return { ok: false, code: 'invalid_url', message: 'Invalid download URL' }
    }
    if (url.protocol !== 'https:') {
      return { ok: false, code: 'insecure_url', message: 'Artifact downloads must use HTTPS' }
    }
    const host = url.hostname.toLowerCase()
    if (!allowedHosts.size) {
      return {
        ok: false,
        code: 'download_host_policy_unconfigured',
        message: 'Artifact download host allowlist is not configured'
      }
    }
    let allowed = false
    for (const entry of allowedHosts) {
      if (host === entry) {
        allowed = true
        break
      }
    }
    if (!allowed) {
      return { ok: false, code: 'host_not_allowed', message: 'Download host not in allowlist' }
    }
    let pinnedAddresses = null
    if (!trustAllowedHostsWithoutDns) {
      const addresses = await resolveHostAddresses(host)
      for (const ip of addresses) {
        if (isPrivateIp(ip)) {
          return { ok: false, code: 'private_target', message: 'Download resolves to private address' }
        }
      }
      pinnedAddresses = addresses
    }
    return { ok: true, url, host, pinnedAddresses }
  }

  async function fetchPinned(url, host, pinnedAddresses, signal) {
    if (fetchImpl) {
      return fetchImpl(url, { redirect: 'manual', signal })
    }
    if (!pinnedAddresses?.length) {
      throw new Error('Pinned addresses required for HTTPS download')
    }
    const connectHost = pinnedAddresses[0]
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          host: connectHost,
          port: url.port || 443,
          servername: host,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { Host: host, Accept: 'application/json' },
          signal
        },
        (res) => resolve(nodeResponseToWeb(res))
      )
      req.on('error', reject)
      req.end()
    })
  }

  async function readBodyWithDeadline(res, deadlineMs) {
    const reader = res.body?.getReader?.()
    if (!reader) {
      const remaining = deadlineMs - Date.now()
      if (remaining <= 0) return { ok: false, code: 'download_timeout', message: 'Download timed out' }
      const text = await res.text()
      if (Buffer.byteLength(text, 'utf8') > maxBytes) {
        return { ok: false, code: 'oversized', message: 'Artifact exceeds size limit' }
      }
      const digest = crypto.createHash('sha256').update(text).digest('hex')
      const parsed = parseStrictJson(text)
      if (!parsed.ok) return parsed
      return { ...parsed, byteDigest: digest }
    }

    const chunks = []
    let total = 0
    while (true) {
      if (Date.now() > deadlineMs) {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        return { ok: false, code: 'download_timeout', message: 'Download timed out' }
      }
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        return { ok: false, code: 'oversized', message: 'Artifact exceeds size limit' }
      }
      chunks.push(value)
    }
    const text = Buffer.concat(chunks).toString('utf8')
    const digest = crypto.createHash('sha256').update(text).digest('hex')
    const parsed = parseStrictJson(text)
    if (!parsed.ok) return parsed
    return { ...parsed, byteDigest: digest }
  }

  async function downloadJson(urlString, redirectCount = 0, deadlineMs = Date.now() + timeoutMs) {
    const safe = await assertSafeUrl(urlString)
    if (!safe.ok) return safe

    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), Math.max(0, deadlineMs - Date.now()))
    let res
    try {
      res = await fetchPinned(safe.url, safe.host, safe.pinnedAddresses, controller.signal)
    } catch (err) {
      clearTimeout(abortTimer)
      return {
        ok: false,
        code: err.name === 'AbortError' ? 'download_timeout' : 'download_failed',
        message: err.message
      }
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(abortTimer)
      const location = res.headers.get('location')
      if (!location || redirectCount >= maxRedirects) {
        return { ok: false, code: 'redirect_limit', message: 'Too many redirects' }
      }
      const next = new URL(location, safe.url).toString()
      return downloadJson(next, redirectCount + 1, deadlineMs)
    }

    if (!res.ok) {
      clearTimeout(abortTimer)
      return { ok: false, code: 'download_http', message: `Download HTTP ${res.status}` }
    }

    const contentType = String(res.headers.get('content-type') || '').toLowerCase()
    if (!contentType.includes('json')) {
      clearTimeout(abortTimer)
      return { ok: false, code: 'content_type', message: 'Artifact download must be application/json' }
    }

    try {
      const body = await readBodyWithDeadline(res, deadlineMs)
      return body
    } finally {
      clearTimeout(abortTimer)
    }
  }

  return { downloadJson, assertSafeUrl }
}

export function isArtifactDownloadPolicyConfigured() {
  return parseAllowedHostsEnv().size > 0
}
