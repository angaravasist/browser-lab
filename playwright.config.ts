import { defineConfig } from '@playwright/test';

// Playwright's Chromium only drives BrowserLab's own UI; the browsers under test run in the Grid.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 300_000,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: process.env.BROWSERLAB_E2E_BASE ?? 'http://127.0.0.1:3000', viewport: { width: 1600, height: 1000 }, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
