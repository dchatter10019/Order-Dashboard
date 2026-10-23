const { enforceCustomerScope } = require('./gatewayAuth.cjs')

const SUBMIT_SCOPE = 'analytics:submit'
const READ_SCOPE = 'analytics:read'

function hasScope(scopes, required) {
  if (!Array.isArray(scopes)) return false
  return scopes.includes(required)
}

function customerFiltersForOperation(operation, args) {
  if (args.customer) return [String(args.customer)]
  if (Array.isArray(args.customers) && args.customers.length) return args.customers.map(String)
  return []
}

function operationRequiresCompanyWideAccess(operation, args) {
  if (operation === 'bevvi_planning_forecast') return true
  return customerFiltersForOperation(operation, args).length === 0
}

function authorizeJobSubmission(clientMeta, operation, args) {
  if (!clientMeta?.clientId) {
    return { ok: false, code: 'unauthorized', message: 'Missing authenticated client identity' }
  }
  if (!hasScope(clientMeta.scopes, SUBMIT_SCOPE)) {
    return { ok: false, code: 'forbidden', message: 'analytics:submit scope required to submit jobs' }
  }
  if (clientMeta.companyWideForbidden && operationRequiresCompanyWideAccess(operation, args)) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'Company-wide analytics not permitted for this client identity'
    }
  }
  return enforceCustomerScope(clientMeta, operation, args)
}

function authorizeJobRetrieval(clientMeta, job) {
  if (!clientMeta?.clientId) {
    return { ok: false, code: 'unauthorized', message: 'Missing authenticated client identity' }
  }
  if (!hasScope(clientMeta.scopes, READ_SCOPE)) {
    return { ok: false, code: 'forbidden', message: 'analytics:read scope required' }
  }
  if (job.clientId !== clientMeta.clientId) {
    return { ok: false, code: 'forbidden', message: 'Job belongs to another client' }
  }
  if (clientMeta.companyWideForbidden && operationRequiresCompanyWideAccess(job.operation, job.arguments)) {
    return {
      ok: false,
      code: 'forbidden',
      message: 'Retrieval denied: job exceeds current customer scope'
    }
  }
  return enforceCustomerScope(clientMeta, job.operation, job.arguments)
}

module.exports = {
  SUBMIT_SCOPE,
  READ_SCOPE,
  authorizeJobSubmission,
  authorizeJobRetrieval,
  operationRequiresCompanyWideAccess,
  customerFiltersForOperation
}
