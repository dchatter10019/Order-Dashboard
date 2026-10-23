#!/usr/bin/env node
/**
 * Starts administrator OAuth for Perplexity Computer MCP (local gateway admin route).
 */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const setupKey = process.env.BEVVI_ANALYTICS_GATEWAY_SETUP_KEY
if (!setupKey) {
  console.error('Set BEVVI_ANALYTICS_GATEWAY_SETUP_KEY in .env before running OAuth setup.')
  process.exit(1)
}

const host = process.env.BEVVI_ANALYTICS_GATEWAY_HOST || '127.0.0.1'
const port = process.env.BEVVI_ANALYTICS_GATEWAY_PORT || '8791'
const res = await fetch(`http://${host}:${port}/analytics/admin/oauth/start`, {
  method: 'POST',
  headers: { 'X-Bevvi-Analytics-Setup-Key': setupKey }
})
const body = await res.json()
if (!res.ok) {
  console.error(body.error || 'OAuth start failed')
  process.exit(1)
}
const url = body.authorizationUrl
if (!url) {
  console.error('No authorization URL returned — check gateway logs')
  process.exit(1)
}
console.log('Administrator OAuth: open this URL in your browser, sign in, and approve access:')
console.log(url)
console.log('\nAfter redirect completes, run: npm run verify:analytics-gateway-oauth')
