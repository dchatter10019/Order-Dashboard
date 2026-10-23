const { acquireAdvisoryLockHold } = require('./osAdvisoryLock.cjs')

const GATEWAY_SERVER_MUTEX_SEGMENT = 'gateway-server.singleton.mutex'

/** @type {{ release: () => void, mutexPath: string } | null} */
let serverStoreHold = null

/** @type {{ release: () => void, mutexPath: string } | null} */
let maintenanceStoreHold = null

function acquireGatewayServerStoreOwnership() {
  if (serverStoreHold) {
    return { ok: true, reused: true }
  }
  if (maintenanceStoreHold) {
    return {
      ok: false,
      code: 'gateway_store_busy',
      message: 'Maintenance holds the jobs store mutex in this process'
    }
  }
  const hold = acquireAdvisoryLockHold(GATEWAY_SERVER_MUTEX_SEGMENT)
  if (!hold.ok) {
    return {
      ok: false,
      code: 'gateway_store_busy',
      message: 'Another gateway server or scheduler already owns this jobs store'
    }
  }
  serverStoreHold = hold
  return { ok: true, mutexPath: hold.mutexPath }
}

function releaseGatewayServerStoreOwnership() {
  if (serverStoreHold) {
    serverStoreHold.release()
    serverStoreHold = null
  }
}

function acquireGatewayMaintenanceStoreOwnership() {
  if (maintenanceStoreHold) {
    return {
      ok: false,
      code: 'gateway_store_busy',
      message: 'Another maintenance operation already owns this jobs store in this process'
    }
  }
  if (serverStoreHold) {
    return {
      ok: false,
      code: 'gateway_store_busy',
      message: 'Gateway server holds the jobs store mutex in this process'
    }
  }
  const hold = acquireAdvisoryLockHold(GATEWAY_SERVER_MUTEX_SEGMENT)
  if (!hold.ok) {
    return {
      ok: false,
      code: 'gateway_store_busy',
      message: 'Mutating maintenance is blocked while another owner holds this jobs store'
    }
  }
  maintenanceStoreHold = hold
  return {
    ok: true,
    mutexPath: hold.mutexPath,
    release() {
      if (maintenanceStoreHold === hold) {
        hold.release()
        maintenanceStoreHold = null
      }
    }
  }
}

function releaseGatewayMaintenanceStoreOwnership() {
  if (maintenanceStoreHold) {
    maintenanceStoreHold.release()
    maintenanceStoreHold = null
  }
}

function gatewayServerMutexPath() {
  const { mutexPathForSegment } = require('./osAdvisoryLock.cjs')
  return mutexPathForSegment(GATEWAY_SERVER_MUTEX_SEGMENT)
}

module.exports = {
  GATEWAY_SERVER_MUTEX_SEGMENT,
  acquireGatewayServerStoreOwnership,
  releaseGatewayServerStoreOwnership,
  acquireGatewayMaintenanceStoreOwnership,
  releaseGatewayMaintenanceStoreOwnership,
  gatewayServerMutexPath
}
