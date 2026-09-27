/**
 * ESM bridge for Vite — imports the CJS module via default export (see vite.config.js plugin).
 */
import inference from './manualOrderDeliveryInference.cjs'

export const deriveManualOrderDeliveryFee = inference.deriveManualOrderDeliveryFee
export const isManualOrderRecord = inference.isManualOrderRecord
