import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchStudio } from './launch';
import { APP_URL } from '../../src/main/security';


test('built Electron enforces boundaries and saves preferences across a native relaunch', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'factory-electron-'));
  let instance: ElectronApplication | undefined;

  const launch = async () => {
    instance = await launchStudio(profile);
    const effective = await instance.evaluate(({ app }) => app.getPath('userData'));
    expect(await realpath(effective)).toBe(await realpath(profile));
    return instance;
  };

  try {
    const first = await launch();
    const page = await first.firstWindow();
    await expect(page).toHaveURL(APP_URL);
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    expect(await first.evaluate(({ app }) => app.commandLine.hasSwitch('no-sandbox'))).toBe(false);

    const boundary = await page.evaluate(async () => ({
      node: typeof Reflect.get(window, 'require'),
      process: typeof Reflect.get(window, 'process'),
      ipc: typeof Reflect.get(window, 'ipcRenderer'),
      appInfo: await window.studio?.getAppInfo(),
      invalid: await Reflect.apply(window.studio!.writePreferences, null, [
        { action: 'update', changes: { theme: 'light', extra: 'unexpected' } },
      ]),
      popup: window.open('about:blank') === null,
    }));
    expect(boundary).toMatchObject({
      node: 'undefined', process: 'undefined', ipc: 'undefined', appInfo: { ok: true },
      invalid: { ok: false, error: 'INVALID_REQUEST' }, popup: true,
    });

    const bundled = await page.evaluate(async () => {
      const response = await fetch('/').catch(() => null);
      return response?.headers.get('Content-Security-Policy') ?? 'blocked-by-connect-policy';
    });
    expect(bundled).toBe('blocked-by-connect-policy');
    const csp = await first.evaluate(async ({ net }) => (await net.fetch('studio://app/')).headers.get('Content-Security-Policy'));
    expect(csp).toContain("script-src 'self'");
    expect(await first.evaluate(async ({ net }) => (await net.fetch('studio://app/addresses.json')).status)).toBe(404);

    await test.step('permission checks reject unexpected access', async () => {
      const denied = await page.evaluate(async () => {
        const geolocation = await navigator.permissions.query({ name: 'geolocation' });
        return geolocation.state;
      });
      expect(denied).toBe('denied');
    });

    const appPath = await first.evaluate(({ app }) => app.getAppPath());
    const unauthorized = await first.evaluate(async ({ BrowserWindow }, preload) => {
      const other = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true } });
      try {
        await other.loadURL('studio://app/');
        return await other.webContents.executeJavaScript(
          "window.studio.writePreferences({ action: 'update', changes: { theme: 'light' } })",
        );
      } finally {
        other.destroy();
      }
    }, join(appPath, 'dist/preload/index.cjs'));
    expect(unauthorized).toEqual({ ok: false, error: 'ACCESS_DENIED' });
    await expect(page.getByRole('separator', { name: 'Sidebar width' })).toHaveAttribute('aria-valuenow', '240');

    const nativeScale = await page.evaluate(() => window.devicePixelRatio);
    await first.evaluate(({ BrowserWindow }) => {
      const current = BrowserWindow.getAllWindows()[0];
      current?.setSize(1024, 768);
      current?.webContents.setZoomFactor(2);
    });
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(nativeScale * 2);
    await expect(page.getByRole('button', { name: 'Open command palette' })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
    await first.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.setZoomFactor(1); });
    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBeCloseTo(nativeScale);

    await page.getByRole('button', { name: 'Open Settings' }).click();
    await first.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const light = page.getByRole('radio', { name: 'Light' });
    await light.click();
    await expect(light).toBeChecked();
    await expect(page.getByText('Preferences saved')).toBeVisible();
    await page.getByRole('separator', { name: 'Sidebar width' }).press('End');
    await expect(page.getByText('Preferences saved')).toBeVisible();
    await expect.poll(async () => JSON.parse(await readFile(join(profile, 'preferences.json'), 'utf8'))).toEqual({
      version: 1, preferences: { theme: 'light', sidebarWidth: 320 },
    });
    await first.close();
    instance = undefined;

    const second = await launch();
    const reopened = await second.firstWindow();
    await expect(reopened.getByRole('separator', { name: 'Sidebar width' })).toHaveAttribute('aria-valuenow', '320');
    await reopened.getByRole('button', { name: 'Open Settings' }).click();
    await expect(reopened.getByRole('radio', { name: 'Light' })).toBeChecked();

    // Check the native window after an attempted top-frame navigation. A cancelled
    // request can leave the Playwright page waiting on the cancelled navigation.
    await reopened.evaluate(() => {
      const link = document.createElement('a');
      link.href = 'http://127.0.0.1:4493/';
      link.textContent = 'Navigation verification link';
      document.body.prepend(link);
    });
    await reopened.getByRole('link', { name: 'Navigation verification link' }).click({ noWaitAfter: true, timeout: 4000 });
    await expect.poll(() => second.evaluate(async ({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]?.webContents;
      return {
        url: contents?.getURL(),
        heading: await contents?.executeJavaScript("document.querySelector('h1')?.textContent"),
      };
    })).toEqual({ url: APP_URL, heading: 'Settings' });
  } finally {
    await instance?.close();
    await rm(profile, { recursive: true, force: true });
  }
});
