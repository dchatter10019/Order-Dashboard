import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': {
    target: 'http://localhost:3001',
    changeOrigin: true
  }
}

export default defineConfig({
  plugins: [react()],
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
