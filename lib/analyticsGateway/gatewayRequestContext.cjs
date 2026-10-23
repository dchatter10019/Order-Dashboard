let currentAuth = null

function runWithGatewayAuth(auth, fn) {
  currentAuth = auth
  try {
    return fn()
  } finally {
    currentAuth = null
  }
}

async function runWithGatewayAuthAsync(auth, fn) {
  currentAuth = auth
  try {
    return await fn()
  } finally {
    currentAuth = null
  }
}

function getGatewayAuth() {
  return currentAuth
}

module.exports = {
  runWithGatewayAuth,
  runWithGatewayAuthAsync,
  getGatewayAuth
}
