/** In-process cache for dashboard-initiated gateway jobs (poll by jobId). */
const entries = new Map()
const CACHE_TTL_MS = 60 * 60 * 1000

function cacheKey(operation, args) {
  return `${operation}:${JSON.stringify(args)}`
}

function getCachedForecast(operation, args) {
  const key = cacheKey(operation, args)
  const hit = entries.get(key)
  if (!hit || hit.kind !== 'result') return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    entries.delete(key)
    return null
  }
  return hit.payload
}

function setCachedForecast(operation, args, payload) {
  const key = cacheKey(operation, args)
  entries.set(key, { kind: 'result', at: Date.now(), payload })
}

function setPendingJob(operation, args, jobId) {
  const key = cacheKey(operation, args)
  entries.set(`job:${jobId}`, { kind: 'pending', at: Date.now(), operation, args, jobId })
}

function getPendingMeta(jobId) {
  return entries.get(`job:${jobId}`) || null
}

function clearPending(jobId) {
  entries.delete(`job:${jobId}`)
}

module.exports = {
  getCachedForecast,
  setCachedForecast,
  setPendingJob,
  getPendingMeta,
  clearPending
}
