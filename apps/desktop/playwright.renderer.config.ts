import { defineConfig } from '@playwright/test';

const systemChromium = process.env.FACTORY_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/renderer',
  fullyParallel: true,
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:4491',
    launchOptions: {
      chromiumSandbox: true,
      ...(systemChromium ? { executablePath: systemChromium } : {}),
    },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm exec vite preview --host 127.0.0.1 --port 4491 --strictPort',
      url: 'http://127.0.0.1:4491/',
    },
    {
      command: 'pnpm exec vite --mode web --port 4492',
      url: 'http://127.0.0.1:4492/',
    },
  ],
});
