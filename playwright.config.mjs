import { defineConfig, devices } from '@playwright/test'
import { E2E_PASSWORD, E2E_USERNAME } from './e2e/constants.mjs'

const previewHost = '127.0.0.1'
const apiPort = Number(process.env.PLAYWRIGHT_API_PORT || 3011)
const previewPort = Number(process.env.PLAYWRIGHT_PREVIEW_PORT || 4173)

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 90_000,
  use: {
    baseURL: `http://${previewHost}:${previewPort}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] }
    }
  ],
  webServer: [
    {
      command: 'node server.js',
      url: `http://${previewHost}:${apiPort}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        DOTENV_CONFIG_OVERRIDE: 'false',
        PORT: String(apiPort),
        DASHBOARD_LOGIN_USERNAME: E2E_USERNAME,
        DASHBOARD_LOGIN_PASSWORD: E2E_PASSWORD
      }
    },
    {
      command: `npm run build && npm run preview -- --host ${previewHost} --port ${previewPort}`,
      env: {
        ...process.env,
        E2E_API_PORT: String(apiPort)
      },
      url: `http://${previewHost}:${previewPort}`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000
    }
  ]
})
