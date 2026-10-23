#!/usr/bin/env node
import http from 'http'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { createRequire } from 'module'
import { handleAnalyticsMcpRequest } from '../lib/analyticsGateway/createMcpGateway.mjs'
import {
  beginAdministratorOAuth,
  completeAdministratorOAuth,
  getOAuthAdminStatus
} from '../lib/analyticsGateway/perplexityOAuthFlow.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '..', '.env') })

const require = createRequire(import.meta.url)
const { authenticateGatewayRequest, loadClientVerifiers } = require('../lib/analyticsGateway/gatewayAuth.cjs')
const { getRuntimeMode, validateModeConfiguration } = require('../lib/analyticsGateway/modes.cjs')
const { recoverInterruptedJobs } = require('../lib/analyticsGateway/jobRecovery.cjs')
const {
  reconcileSubmissionUncertain,
  dispatchQueuedJobsAfterAdmissionRelease
} = require('../lib/analyticsGateway/worker.cjs')
const { resumeArtifactDelivery, processJob } = require('../lib/analyticsGateway/worker.cjs')
const { startArtifactRetryScheduler } = require('../lib/analyticsGateway/artifactRetryScheduler.cjs')
const { startQueuedJobDispatchWatcher } = require('../lib/analyticsGateway/queuedJobDispatch.cjs')
const { validateStartupEnvironment, getGatewayLimits } = require('../lib/analyticsGateway/gatewayLimits.cjs')
const {
  acquireGatewayServerStoreOwnership,
  releaseGatewayServerStoreOwnership
} = require('../lib/analyticsGateway/gatewayStoreSingleton.cjs')

const HOST = process.env.BEVVI_ANALYTICS_GATEWAY_HOST || '127.0.0.1'
const PORT = Number(process.env.BEVVI_ANALYTICS_GATEWAY_PORT || 8791)

const startup = validateStartupEnvironment()
if (!startup.ok) {
  console.error(`[analytics-gateway] startup blocked: ${startup.message}`)
  process.exit(1)
}

const storeOwnership = acquireGatewayServerStoreOwnership()
if (!storeOwnership.ok) {
  console.error(`[analytics-gateway] startup blocked: ${storeOwnership.message}`)
  process.exit(1)
}

function releaseStoreOnExit() {
  releaseGatewayServerStoreOwnership()
}

process.on('SIGINT', () => {
  releaseStoreOnExit()
  process.exit(0)
})
process.on('SIGTERM', () => {
  releaseStoreOnExit()
  process.exit(0)
})
process.on('exit', () => {
  releaseGatewayServerStoreOwnership()
})

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(`${JSON.stringify(body)}\n`)
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = ''
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(Object.assign(new Error('Request body too large'), { code: 'entity_too_large' }))
        req.destroy()
        return
      }
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function assertSetupKey(req) {
  const expected = String(process.env.BEVVI_ANALYTICS_GATEWAY_SETUP_KEY || '').trim()
  if (!expected) return false
  const provided = String(req.headers['x-bevvi-analytics-setup-key'] || '').trim()
  return provided && provided === expected
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const limits = getGatewayLimits()

    if (url.pathname === '/analytics/health' && req.method === 'GET') {
      const modeCheck = validateModeConfiguration(getRuntimeMode())
      return sendJson(res, modeCheck.ok ? 200 : 503, {
        status: modeCheck.ok ? 'ok' : 'misconfigured',
        service: 'bevvi-analytics-gateway',
        enabled: process.env.BEVVI_ANALYTICS_GATEWAY_ENABLED !== 'false',
        mode: getRuntimeMode(),
        modeCheck
      })
    }

    if (url.pathname === '/analytics/admin/oauth/status' && req.method === 'GET') {
      if (!assertSetupKey(req)) return sendJson(res, 403, { error: 'Forbidden' })
      return sendJson(res, 200, getOAuthAdminStatus())
    }

    if (url.pathname === '/analytics/admin/oauth/start' && req.method === 'POST') {
      if (!assertSetupKey(req)) return sendJson(res, 403, { error: 'Forbidden' })
      const started = await beginAdministratorOAuth()
      return sendJson(res, 200, started)
    }

    if (url.pathname === '/analytics/admin/oauth/callback' && req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')
      if (!code || !state) return sendJson(res, 400, { error: 'Missing code or state' })
      const status = await completeAdministratorOAuth({ code, state })
      return sendJson(res, 200, { success: true, status })
    }

    if (
      url.pathname === '/analytics' &&
      (req.method === 'POST' || req.method === 'GET' || req.method === 'DELETE')
    ) {
      const auth = authenticateGatewayRequest(req.headers.authorization, loadClientVerifiers())
      if (!auth.ok) {
        return sendJson(res, 401, { error: auth.message, code: auth.code })
      }

      let parsedBody
      if (req.method === 'POST') {
        let raw
        try {
          raw = await readBody(req, limits.maxBodyBytes)
        } catch (err) {
          if (err.code === 'entity_too_large') {
            return sendJson(res, 413, { error: 'Request body too large', code: err.code })
          }
          throw err
        }
        if (!raw) {
          return sendJson(res, 400, { error: 'Empty POST body' })
        }
        try {
          parsedBody = JSON.parse(raw)
        } catch {
          return sendJson(res, 400, { error: 'Invalid JSON' })
        }
      }

      await handleAnalyticsMcpRequest(req, res, parsedBody, {
        clientId: auth.clientId,
        scopes: auth.scopes,
        allowedCustomers: auth.allowedCustomers,
        companyWideForbidden: auth.companyWideForbidden
      })
      return
    }

    return sendJson(res, 404, { error: 'Not found' })
  } catch (err) {
    console.error('[analytics-gateway] request error:', err.message)
    return sendJson(res, 500, { error: 'Internal server error' })
  }
})

server.listen(PORT, HOST, () => {
  startArtifactRetryScheduler(resumeArtifactDelivery)
  startQueuedJobDispatchWatcher(processJob)
  const recovered = recoverInterruptedJobs(
    resumeArtifactDelivery,
    processJob,
    reconcileSubmissionUncertain,
    dispatchQueuedJobsAfterAdmissionRelease
  )
  if (recovered) {
    console.log(`[analytics-gateway] resumed artifact delivery for ${recovered} interrupted job(s)`)
  }
  console.log(`Bevvi analytics gateway on http://${HOST}:${PORT}/analytics (mode=${getRuntimeMode()})`)
})
