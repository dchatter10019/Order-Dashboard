import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))

const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true,
    timeout: 180000,
    proxyTimeout: 180000
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lib/invoicing-rules': path.resolve(projectRoot, 'lib/invoicingRulesEngine.cjs')
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
