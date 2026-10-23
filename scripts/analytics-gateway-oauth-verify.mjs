#!/usr/bin/env node
/** Redacted OAuth store verification — never prints tokens or store contents. */
import dotenv from 'dotenv'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const require = createRequire(import.meta.url)
const { storePath, redactStoreForStatus, readStore } = require('../lib/analyticsGateway/perplexityOAuthStore.cjs')

const file = storePath()
let modeOk = false
try {
  const st = fs.statSync(file)
  modeOk = (st.mode & 0o777) === 0o600
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log(JSON.stringify({ ok: false, code: 'missing_store' }))
    process.exit(1)
  }
  throw err
}

const redacted = redactStoreForStatus(readStore())
console.log(
  JSON.stringify(
    {
      ok: redacted.hasTokens && redacted.hasClient,
      file_permissions_ok: modeOk,
      hasClient: redacted.hasClient,
      hasTokens: redacted.hasTokens,
      hasRefreshToken: redacted.hasRefreshToken,
      tokenExpiresAt: redacted.tokenExpiresAt,
      updatedAt: redacted.updatedAt
    },
    null,
    2
  )
)
process.exit(redacted.hasTokens ? 0 : 1)
