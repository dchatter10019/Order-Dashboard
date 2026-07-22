/**
 * Client-side fee helpers — rules are loaded at runtime from GET /api/invoicing-rules
 * (parsed from docs/Bevvi-Invoicing-Rules.md on the server). Use useInvoicingRules().
 */

export { normalizeEstablishmentForFees } from '@lib/invoicing-rules'
export { useInvoicingRules, InvoicingRulesProvider } from '../context/InvoicingRulesContext'

export function parseOrderCalendarDate(order) {
  const raw = order?.orderDate || order?.date || ''
  const value = String(raw).trim()
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return (
    `${parsed.getFullYear()}-` +
    `${String(parsed.getMonth() + 1).padStart(2, '0')}-` +
    `${String(parsed.getDate()).padStart(2, '0')}`
  )
}

export function isIncludedOrderStatus(status, excludedStatuses = ['pending', 'rejected', 'canceled']) {
  const normalized = String(status || '').trim().toLowerCase()
  const excluded = new Set(excludedStatuses.map((s) => s.toLowerCase()))
  return normalized.length > 0 && !excluded.has(normalized)
}
