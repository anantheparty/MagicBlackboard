import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

const baseURL = process.env['BASE_URL'] || 'http://localhost:7300';
const useSystemChrome = process.env['PLAYWRIGHT_USE_SYSTEM_CHROME'] === '1';

export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/.playwright/apps/magic-blackboard-e2e/test-output',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [
        ['list'],
        ['blob', { outputDir: '../../dist/.playwright/apps/magic-blackboard-e2e/blob-report' }],
      ]
    : [['list']],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx nx serve magic-blackboard --host=127.0.0.1',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(useSystemChrome ? { channel: 'chrome' } : {}) },
    },
  ],
});
