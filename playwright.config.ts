import path from 'node:path'
import os from 'node:os'
import { defineConfig, devices } from '@playwright/test'

const root = path.join(os.tmpdir(), 'printhub-playwright')

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `rm -rf ${root} && mkdir -p ${root}/data ${root}/prints && DATA_DIR=${root}/data PRINTS_DIR=${root}/prints BETTER_AUTH_URL=http://127.0.0.1:4173 pnpm dev --host 127.0.0.1 --port 4173`,
    url: 'http://127.0.0.1:4173/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
