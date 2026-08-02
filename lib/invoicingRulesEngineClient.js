/**
 * ESM bridge for Vite — imports the CJS rules engine via default export (see vite.config.js plugin).
 */
import rules from './invoicingRulesEngine.cjs'

export const parseInvoicingRulesMarkdown = rules.parseInvoicingRulesMarkdown
export const createInvoicingRulesEngine = rules.createInvoicingRulesEngine
export const normalizeEstablishmentForFees = rules.normalizeEstablishmentForFees
