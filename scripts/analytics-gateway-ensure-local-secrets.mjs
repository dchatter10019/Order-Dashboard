#!/usr/bin/env node
/**
 * Appends gateway client/setup secrets to .env if missing. Never prints secret values.
 */
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.join(__dirname, '..', '.env')

function randomSecret(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

let content = ''
try {
  content = fs.readFileSync(envPath, 'utf8')
} catch (err) {
  if (err.code !== 'ENOENT') throw err
}

const need = []
if (!/^BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN=/m.test(content)) {
  need.push(`BEVVI_ANALYTICS_GATEWAY_CLIENT_TOKEN=${randomSecret(32)}`)
}
if (!/^BEVVI_ANALYTICS_GATEWAY_SETUP_KEY=/m.test(content)) {
  need.push(`BEVVI_ANALYTICS_GATEWAY_SETUP_KEY=${randomSecret(32)}`)
}
if (!/^BEVVI_ANALYTICS_GATEWAY_MODE=/m.test(content)) {
  need.push('BEVVI_ANALYTICS_GATEWAY_MODE=smoke')
}
if (!/^BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE=/m.test(content)) {
  need.push('BEVVI_ANALYTICS_GATEWAY_SMOKE_ENABLE=true')
}
if (!/^BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE=/m.test(content)) {
  need.push('BEVVI_ANALYTICS_GATEWAY_PRODUCTION_ENABLE=false')
}

if (need.length) {
  const prefix = content.length && !content.endsWith('\n') ? '\n' : ''
  const block = `${prefix}\n# Bevvi Analytics Gateway (local — added ${new Date().toISOString()})\n${need.join('\n')}\n`
  fs.appendFileSync(envPath, block, { encoding: 'utf8', mode: 0o600 })
  console.log(`Updated .env (${need.map((l) => l.split('=')[0]).join(', ')})`)
} else {
  console.log('.env already has analytics gateway secrets')
}

try {
  fs.chmodSync(envPath, 0o600)
} catch {
  /* ignore */
}

const dataDir = path.join(__dirname, '..', 'data', 'analytics-gateway')
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 })
try {
  fs.chmodSync(dataDir, 0o700)
} catch {
  /* ignore */
}

console.log('analytics-gateway-ensure-local-secrets: OK')
