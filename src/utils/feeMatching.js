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

/** Per-order flat retailer fees (non–VistaJet). Keys must use normalizeEstablishmentForFees output. */
export const FLAT_RETAILER_FEES_USD = {
  'sundance liquor and gifts': 40,
  'heritage wine and liquor': 13
}
