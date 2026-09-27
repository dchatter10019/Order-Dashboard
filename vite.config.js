import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/** Vite dev cannot import named exports from local .cjs files — expose a default export instead. */
function localCjsDefaultExportInterop() {
  return {
    name: 'local-cjs-default-export-interop',
    transform(code, id) {
      const normalized = id.replace(/\\/g, '/')
      if (normalized.endsWith('lib/manualOrderBulkSpreadsheet.cjs')) {
        return {
          code: code
            .replace(/const XLSX = require\('xlsx-js-style'\)/, "import XLSX from 'xlsx-js-style'")
            .replace(/module\.exports\s*=\s*\{/, 'export default {'),
          map: null
        }
      }
      if (normalized.endsWith('lib/invoicingRulesEngine.cjs')) {
        return {
          code: code.replace(/module\.exports\s*=\s*\{/, 'export default {'),
          map: null
        }
      }
      if (normalized.endsWith('lib/manualOrderDeliveryInference.cjs')) {
        return {
          code: code.replace(/module\.exports\s*=\s*\{/, 'export default {'),
          map: null
        }
      }
      return null
    }
  }
}

const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    // Bulk manual orders / tax can run many minutes — match server timeouts.
    timeout: 600000,
    proxyTimeout: 600000
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react({
      jsxRuntime: 'automatic',
      babel: {
        plugins: mode === 'production' ? [] : undefined
      }
    }),
    localCjsDefaultExportInterop()
  ],
  resolve: {
    alias: {
      '@lib/invoicing-rules': path.resolve(projectRoot, 'lib/invoicingRulesEngineClient.js'),
      '@lib/bulk-spreadsheet': path.resolve(projectRoot, 'lib/manualOrderBulkSpreadsheetClient.js'),
      '@lib/manual-order-delivery': path.resolve(projectRoot, 'lib/manualOrderDeliveryInferenceClient.js'),
      stream: path.resolve(projectRoot, 'lib/streamBrowserShim.js')
    }
  },
  optimizeDeps: {
    exclude: ['xlsx-js-style']
  },
  server: {
    port: 3000,
    proxy: { ...apiProxy }
  },
  // `vite preview` runs a production build without `server`; proxy must be set for `/api`.
  preview: {
    port: 4173,
    proxy: { ...apiProxy }
  },
  build: {
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2020'
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : []
  }
}))
