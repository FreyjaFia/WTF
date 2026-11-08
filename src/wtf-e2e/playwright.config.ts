import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests',
  globalSetup: require.resolve('./global-setup'),
  timeout: 60_000,
  expect: { timeout: 30_000 },
  // Files run side by side; the tests inside one file run in order. Every test seeds its own data and asserts only on
  // it, so they can share the one throwaway database.
  // 3 workers, not 5: with 5 browsers, the API, LocalDB and the dev server on one PC, the suite took 11 minutes and a
  // different 2 to 20 tests timed out each run (every one passed alone); with 3 it takes about 8 and only 1 or 2 do.
  // The expect timeout is 30 seconds because a page can take 15+ seconds to appear when the machine is busy.
  // One retry everywhere, so a rare timing blip is retried instead of failing the run. A test that needed the retry is
  // reported as "flaky" by Playwright, so it stays visible. On CI (4 cores) it uses 4 workers.
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : process.env.CI ? 4 : 3,
  fullyParallel: false,
  retries: 1,
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

