import { defineConfig, devices } from '@playwright/test';

/**
 * E2E suite against the real app (Next.js + Postgres), not the mocked pipeline
 * harness used by `npm run test:b1`. Requires a seeded database and a running
 * server — see tests/e2e/README.md. The server is NOT started by this config
 * (it needs a real Postgres + seed, which `webServer` can't sequence), so start
 * it yourself first: `npm run dev` (or `PORT=3100 npx tsx server.ts`), then
 * `npm run test:e2e` with E2E_BASE_URL pointing at it.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // shared seeded DB — tests mutate meetings/tasks, so keep them sequential
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { outputFolder: 'tests/e2e/report', open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 }, // Mock LLM adds artificial latency per call; default 5s is tight
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3100',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
