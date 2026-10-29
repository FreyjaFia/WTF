import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  globalSetup: require.resolve('./global-setup'),
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // Files run side by side (5 browsers); the tests inside one file run in order. Every test seeds its own data and
  // asserts only on it, so they can share the one throwaway database.
  // On CI: 4 workers (a runner for a public repository has 4 cores and 16 GB), and one retry so a slow runner does not
  // fail the job on a timing blip.
  workers: process.env.CI ? 4 : 5,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }], ['json', { outputFile: 'test-results/results.json' }]]
    : [['list'], ['json', { outputFile: 'test-results/results.json' }]],
  use: {
    baseURL: process.env.E2E_APP_ORIGIN ?? 'http://localhost:4300',
    timezoneId: 'Asia/Manila',
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});

