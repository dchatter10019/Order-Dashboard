import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

/** Vite dev cannot import named exports from local .cjs files — expose a default export instead. */
function invoicingRulesCjsInterop() {
  return {
    name: 'invoicing-rules-cjs-interop',
    transform(code, id) {
      const normalized = id.replace(/\\/g, '/')
      if (!normalized.endsWith('lib/invoicingRulesEngine.cjs')) {
        return null
      }
      return {
        code: code.replace(/module\.exports\s*=\s*\{/, 'export default {'),
        map: null
      }
    }
  }
}

const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    timeout: 180000,
    proxyTimeout: 180000
  }
}

export default defineConfig({
  plugins: [react(), invoicingRulesCjsInterop()],
  resolve: {
    alias: {
      '@lib/invoicing-rules': path.resolve(projectRoot, 'lib/invoicingRulesEngineClient.js')
    }
  },
  server: {
    port: 3000,
    proxy: { ...apiProxy }
  },
  // `vite preview` runs a production build without `server`; proxy must be set for `/api`.
  preview: {
    port: 4173,
    proxy: { ...apiProxy }
  }
})
