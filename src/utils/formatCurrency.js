/**
 * Format a number as currency with proper comma separators
 * @param {number|string} amount - The amount to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted currency string
 */
export const formatCurrency = (amount, decimals = 2) => {
  const num = parseFloat(amount) || 0
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}

/**
 * Format a number as currency with dollar sign
 * @param {number|string} amount - The amount to format
 * @param {number} decimals - Number of decimal places (default: 2)
 * @returns {string} Formatted currency string with $ prefix
 */
export const formatDollarAmount = (amount, decimals = 2) => {
  return `$${formatCurrency(amount, decimals)}`
}

/**
 * Format a number with comma separators (no currency symbol)
 * @param {number|string} number - The number to format
 * @param {number} decimals - Number of decimal places (default: 0)
 * @returns {string} Formatted number string with commas
 */
export const formatNumber = (number, decimals = 0) => {
  const num = parseFloat(number) || 0
  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  })
}
