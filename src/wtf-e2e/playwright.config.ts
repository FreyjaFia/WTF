import { defineConfig } from '@playwright/test';
const MIN_WORKERS = 3;

export default defineConfig({
  testDir: 'tests',
  globalSetup: require.resolve('./global-setup'),
  timeout: 60_000,
  expect: { timeout: 30_000 },
  // Every test seeds its own data and asserts only on it, so all tests can run side by side in the one throwaway
  // database, including tests of the same file. Nothing is retried: a test that fails is a real failure to fix.
  // Never fewer than 3 workers (a standing rule, E2E_WORKERS cannot go below it): 3 on a PC, 4 on CI.
  // The expect timeout is 30 seconds because a page can take 15+ seconds to appear when the machine is busy.
  workers: Math.max(MIN_WORKERS, process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : process.env.CI ? 4 : 3),
  fullyParallel: true,
  retries: 0,
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

