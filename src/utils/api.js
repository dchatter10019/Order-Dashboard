/**
 * Get the API base URL for making requests
 * In development, uses relative URLs (handled by Vite proxy)
 * In production, uses the API_BASE_URL environment variable or defaults to same origin
 */
export const getApiBaseUrl = () => {
  // Check if we're in development (Vite sets import.meta.env.DEV)
  if (import.meta.env.DEV) {
    // In development, use relative URLs - Vite proxy will handle it
    return ''
  }
  
  // In production, use environment variable or default to same origin
  // This allows configuring the backend URL via environment variable
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || ''
  
  // If VITE_API_BASE_URL is set, use it (e.g., 'https://api.example.com' or 'http://localhost:3001')
  // If not set, use empty string (same origin - assumes frontend and backend are on same domain)
  return apiBaseUrl
}

/**
 * Make an API request with the correct base URL
 * @param {string} endpoint - API endpoint (e.g., '/api/stores')
 * @param {RequestInit} options - Fetch options
 * @returns {Promise<Response>}
 */
export const apiFetch = async (endpoint, options = {}) => {
  const { timeoutMs, signal: externalSignal, ...fetchOptions } = options
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${endpoint}`

  console.log(`🌐 API Request: ${url}`)

  if (!timeoutMs && !externalSignal) {
    return fetch(url, fetchOptions)
  }

  const controller = new AbortController()
  const timeoutId = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null

  const onExternalAbort = () => controller.abort()
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true })
    }
  }

  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal })
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort)
    }
  }
}

/** User-facing message for fetch failures (timeouts, proxy drops, offline). */
export function formatApiFetchError(error, { longRunning = false } = {}) {
  if (error?.name === 'AbortError') {
    return longRunning
      ? 'Request timed out. Large batches can take several minutes — check Bevvi for created orders before retrying.'
      : 'Request timed out.'
  }
  const message = String(error?.message || '')
  if (message === 'Failed to fetch' || error instanceof TypeError) {
    return longRunning
      ? 'Connection lost while waiting for the server. Orders may still have been created in Bevvi — verify before retrying.'
      : 'Network error — is the backend running on port 3001?'
  }
  return message || 'Network error'
}

/**
 * Parse a fetch Response as JSON, with a clear error when the server returns HTML/text.
 */
export async function parseApiJsonResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  const text = await response.text()
  if (text.trimStart().startsWith('<!DOCTYPE') || text.trimStart().startsWith('<html')) {
    if (response.status === 404) {
      throw new Error(
        'Tax API not found — restart the backend server (npm run server) so the latest routes are loaded.'
      )
    }
    throw new Error('Server returned an HTML page instead of JSON. Is the backend running on port 3001?')
  }

  try {
    return JSON.parse(text)
  } catch {
    throw new Error(text.slice(0, 200) || `Unexpected response (${response.status})`)
  }
}

/**
 * Get the full API URL for endpoints that need absolute URLs (like EventSource)
 * @param {string} endpoint - API endpoint (e.g., '/api/events')
 * @returns {string} Full URL
 */
export const getApiUrl = (endpoint) => {
  const baseUrl = getApiBaseUrl()
  return `${baseUrl}${endpoint}`
}
