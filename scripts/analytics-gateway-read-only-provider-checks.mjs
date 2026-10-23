#!/usr/bin/env node
/**
 * Explicitly invoked, separately authorized metadata capture only.
 * Does not run as part of the gateway or its test chain.
 */
import dotenv from 'dotenv'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { captureProviderEvidence, readOnlyTransportOptions } from '../lib/analyticsGateway/providerEvidenceCapture.mjs'
const require = createRequire(import.meta.url)
const { COMPUTER_MCP_URL } = require('../lib/analyticsGateway/constants.cjs')
const { readStore } = require('../lib/analyticsGateway/perplexityOAuthStore.cjs')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function main() {
  dotenv.config({ path: path.join(root, '.env') })
  const out = path.join(root, 'docs', 'provider-evidence')
  let client
  try {
    // Auth checkpoint is detected before creating files or a client.
    const options = readOnlyTransportOptions(readStore())
    client = new Client({ name: 'bevvi-provider-read-only-evidence', version: '2.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(COMPUTER_MCP_URL), options))
    const capture = await captureProviderEvidence(client)
    fs.mkdirSync(out, { recursive: true, mode: 0o700 })
    const hashes = {}
    for (const [name, value] of Object.entries(capture.documents)) {
      const bytes = JSON.stringify(value, null, 2) + '\n'
      fs.writeFileSync(path.join(out, name), bytes, { mode: 0o600 })
      hashes[name] = crypto.createHash('sha256').update(bytes).digest('hex')
    }
    const report = {
      ...capture.summary, file_sha256: hashes, hash_basis: 'exact UTF-8 file bytes',
      allowlist_changed: false, oauth_changed: false, artifact_body_fetched: false
    }
    fs.writeFileSync(path.join(out, 'COMPUTER_MCP_READ_ONLY_CHECKS.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 })
    console.log(JSON.stringify(report, null, 2))
    return capture.summary.status === 'READ_ONLY_CAPTURE_COMPLETE' ? 0 : 1
  } catch (err) {
    // Never print provider exceptions, response bodies, URLs or token-bearing objects.
    const code = err?.checkpointCode === 'needs_auth' || err?.status === 401 ||
      err?.status === 403 || err?.name === 'UnauthorizedError' ? 'needs_auth' : 'provider_capture_checkpoint'
    console.log(JSON.stringify({ status: 'CHECKPOINT', code, analytical_submissions: 0, artifact_body_fetched: false }))
    return 1
  } finally {
    if (client) { try { await client.close() } catch { /* no raw error logging */ } }
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
