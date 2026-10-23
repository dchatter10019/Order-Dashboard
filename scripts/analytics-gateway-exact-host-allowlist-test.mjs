#!/usr/bin/env node
/**
 * Exact-host artifact download allowlist (offline, no network fetch to provider).
 */
import assert from 'node:assert/strict'
import { createSecureArtifactDownloader } from '../lib/analyticsGateway/secureArtifactDownload.mjs'

const APPROVED = 'd2z0o16i8xm8ak.cloudfront.net'
const allowedHosts = new Set([APPROVED])

function dl(overrides = {}) {
  return createSecureArtifactDownloader({
    allowedHosts,
    trustAllowedHostsWithoutDns: true,
    ...overrides
  })
}

// Exact approved hostname accepted
{
  const out = await dl().assertSafeUrl(`https://${APPROVED}/artifact/job.json`)
  assert.equal(out.ok, true)
  assert.equal(out.host, APPROVED)
}

// Subdomain of approved host rejected
{
  const out = await dl().assertSafeUrl(`https://cdn.${APPROVED}/x.json`)
  assert.equal(out.ok, false)
  assert.equal(out.code, 'host_not_allowed')
}

// Sibling CloudFront host rejected
{
  const out = await dl().assertSafeUrl('https://d11111111111111.cloudfront.net/x.json')
  assert.equal(out.ok, false)
  assert.equal(out.code, 'host_not_allowed')
}

// Lookalike hostnames rejected
for (const evil of [
  `${APPROVED}.evil.example`,
  `not-${APPROVED}`,
  'd2z01016i8xm8ak.cloudfront.net',
  'd2z0o16i8xm8ak.cloudfront.net.com'
]) {
  const out = await dl().assertSafeUrl(`https://${evil}/x.json`)
  assert.equal(out.ok, false, `expected reject for ${evil}`)
  assert.equal(out.code, 'host_not_allowed')
}

// HTTPS required
{
  const out = await dl().assertSafeUrl(`http://${APPROVED}/x.json`)
  assert.equal(out.ok, false)
  assert.equal(out.code, 'insecure_url')
}

// Redirect from approved host to unapproved host rejected
{
  const downloader = dl({
    fetchImpl: async () => ({
      status: 302,
      ok: false,
      headers: { get: (k) => (k.toLowerCase() === 'location' ? 'https://evil.cloudfront.net/x.json' : null) }
    })
  })
  const out = await downloader.downloadJson(`https://${APPROVED}/x.json`)
  assert.equal(out.ok, false)
  assert.equal(out.code, 'host_not_allowed')
}

// Redirect to private/reserved target still rejected
{
  const downloader = dl({
    fetchImpl: async () => ({
      status: 302,
      ok: false,
      headers: { get: () => 'https://127.0.0.1/evil.json' }
    })
  })
  const out = await downloader.downloadJson(`https://${APPROVED}/x.json`)
  assert.equal(out.ok, false)
}

// Successful JSON download on exact host (mock transport)
{
  const payload = { job_id: 'offline-only', ok: true }
  const downloader = dl({
    fetchImpl: async () => ({
      status: 200,
      ok: true,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
      body: {
        getReader() {
          const text = JSON.stringify(payload)
          let done = false
          return {
            async read() {
              if (done) return { done: true, value: undefined }
              done = true
              return { done: false, value: new TextEncoder().encode(text) }
            },
            async cancel() {}
          }
        }
      }
    })
  })
  const out = await downloader.downloadJson(`https://${APPROVED}/x.json`)
  assert.equal(out.ok, true)
  assert.deepEqual(out.payload, payload)
}

console.log('analytics-gateway-exact-host-allowlist-test: OK')
