let xlsxModulePromise = null

/** Lazy-load xlsx-js-style (keeps it off the critical path and pairs with stream shim). */
export function loadXlsxStyle() {
  if (!xlsxModulePromise) {
    xlsxModulePromise = import('xlsx-js-style')
  }
  return xlsxModulePromise
}
