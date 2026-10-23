#!/usr/bin/env node
/** Lists asset names matching a job id (redacted — names only). */
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { BevviPerplexityOAuthProvider } from '../lib/analyticsGateway/perplexityOAuthProvider.mjs'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })
const require = createRequire(import.meta.url)
const { COMPUTER_MCP_URL, COMPUTER_THREAD_ID } = require('../lib/analyticsGateway/constants.cjs')

const jobId = process.argv[2]
if (!jobId) process.exit(1)

const provider = new BevviPerplexityOAuthProvider()
const transport = new StreamableHTTPClientTransport(new URL(COMPUTER_MCP_URL), { authProvider: provider })
const client = new Client({ name: 'asset-list', version: '1.0.0' })
await client.connect(transport)
const { tools } = await client.listTools()
const names = tools.map((t) => t.name)
const listTools = ['list_assets', 'list_thread_assets', 'assets_list']
let assets = []
for (const tool of listTools) {
  if (!names.includes(tool)) continue
  const res = await client.callTool({ name: tool, arguments: { thread_id: COMPUTER_THREAD_ID } })
  const text = (res.content || []).filter((p) => p.type === 'text').map((p) => p.text).join('\n')
  try {
    const parsed = JSON.parse(text)
    const items = parsed.assets || parsed.items || parsed
    if (Array.isArray(items)) assets = assets.concat(items)
  } catch {
    /* ignore */
  }
}
const matches = assets.filter((a) => JSON.stringify(a).includes(jobId))
console.log(JSON.stringify({ threadId: COMPUTER_THREAD_ID, total_assets: assets.length, matches }, null, 2))
await client.close()
