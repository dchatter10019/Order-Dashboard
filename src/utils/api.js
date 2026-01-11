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
  const baseUrl = getApiBaseUrl()
  const url = `${baseUrl}${endpoint}`
  
  console.log(`🌐 API Request: ${url}`)
  
  return fetch(url, options)
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
