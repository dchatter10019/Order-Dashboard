/**
 * Normalize establishment for fee rules so "Wine & Spirits" matches "wine and spirits".
 */
export function normalizeEstablishmentForFees(establishment) {
  return (establishment || '')
    .trim()
    .toLowerCase()
    .replace(/\s*&\s*/g, ' and ')
    .replace(/\s+/g, ' ')
}

/** Per-order flat retailer fees — see invoicingRules.js (rules live in docs/Bevvi-Invoicing-Rules.md). */
export const FLAT_RETAILER_FEES_USD = {}
