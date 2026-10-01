import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', timeout: 90000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173/M.E./', viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.PW_CHROMIUM_EXECUTABLE || undefined, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: { command: 'npm run build && node scripts/serve-dist.mjs', url: 'http://127.0.0.1:4173/M.E./', reuseExistingServer: !process.env.CI, timeout: 60000 }
});
