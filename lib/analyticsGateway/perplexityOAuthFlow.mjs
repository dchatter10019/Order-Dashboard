import { auth } from '@modelcontextprotocol/sdk/client/auth.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createRequire } from 'module'
import {
  BevviPerplexityOAuthProvider,
  consumeOAuthCallbackState,
  getOAuthAdminStatus
} from './perplexityOAuthProvider.mjs'

const require = createRequire(import.meta.url)
const { COMPUTER_MCP_URL } = require('./constants.cjs')
const { readStore } = require('./perplexityOAuthStore.cjs')

export async function beginAdministratorOAuth() {
  const provider = new BevviPerplexityOAuthProvider()
  const serverUrl = new URL(COMPUTER_MCP_URL)
  const result = await auth(provider, { serverUrl, scope: 'asi:query' })
  const pendingUrl = readStore().pendingAuthorizationUrl || null
  return {
    status: result,
    authorizationUrl: pendingUrl,
    admin: getOAuthAdminStatus()
  }
}

export async function completeAdministratorOAuth({ code, state }) {
  consumeOAuthCallbackState(state)
  const provider = new BevviPerplexityOAuthProvider()
  const transport = new StreamableHTTPClientTransport(new URL(COMPUTER_MCP_URL), {
    authProvider: provider
  })
  await transport.finishAuth(code)
  return getOAuthAdminStatus()
}

export { getOAuthAdminStatus }
