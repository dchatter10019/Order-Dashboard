/**
 * ESM bridge for Vite — imports the CJS spreadsheet parser (see vite.config.js plugin).
 */
import bulkSpreadsheet from './manualOrderBulkSpreadsheet.cjs'

export const parseBulkOrderSpreadsheet = bulkSpreadsheet.parseBulkOrderSpreadsheet
export const parseUsAddressFallback = bulkSpreadsheet.parseUsAddressFallback
