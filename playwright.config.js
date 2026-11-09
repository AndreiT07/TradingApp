import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test/browser', fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:3000', launchOptions: { executablePath: process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined), args: ['--no-sandbox'] } },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1100 } } }, { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }],
  webServer: { command: 'npm start', url: 'http://127.0.0.1:3000/api/health', reuseExistingServer: !process.env.CI },
});
