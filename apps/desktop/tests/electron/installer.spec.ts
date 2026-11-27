import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { launchStudio } from './launch';

const lifecycle = process.env.FACTORY_INSTALL_LIFECYCLE;

test('installer lifecycle uses the installed archive and retains real local data', async () => {
  test.skip(!lifecycle, 'Run through the disposable Windows installer lifecycle.');
  test.setTimeout(90_000);
  const stage = process.env.FACTORY_INSTALL_FIXTURE;
  const expectedVersion = process.env.FACTORY_INSTALL_VERSION;
  if (process.platform !== 'win32' || !stage || !expectedVersion || !process.env.FACTORY_INSTALLED_EXECUTABLE) {
    throw new Error('Use the Windows installer lifecycle script.');
  }
  const project = join(stage, 'Client project café');
  const custom = join(project, 'client-owned.txt');
  if (lifecycle === 'seed') {
    await mkdir(project);
    await writeFile(custom, 'Client work survives Studio maintenance.\n', { flag: 'wx' });
  }

  const restrictedTools = lifecycle === 'restricted-tools';
  const environment = { ...process.env };
  if (restrictedTools) {
    // Preserve the normal Windows profile while removing the locations the Studio probe uses.
    for (const name of Object.keys(environment)) {
      if (/^(path|programfiles(?:\(x86\))?|programw6432)$/iu.test(name)) delete environment[name];
    }
    environment.PATH = join(process.env.SystemRoot!, 'System32');
  }
  const instance = await launchStudio(undefined, environment);
  try {
    const page = await instance.firstWindow();
    await expect(page).toHaveURL('studio://app/');
    await expect(page.getByRole('heading', { name: 'Home', level: 1 })).toBeVisible();
    const native = await instance.evaluate(async ({ app, BrowserWindow }) => {
      const fs = process.getBuiltinModule('node:fs')!;
      const path = process.getBuiltinModule('node:path')!;
      const root = app.getAppPath();
      const bundles = fs.readdirSync(root).sort();
      const assets = fs.readdirSync(path.join(root, 'dist', 'renderer', 'assets'));
      const docs = fs.readdirSync(path.join(root, 'docs')).sort();
      const renderer = BrowserWindow.getAllWindows()[0]?.webContents.getOSProcessId();
      const sandboxed = app.getAppMetrics().find(({ pid }) => pid === renderer)?.sandboxed;
      return {
        root, bundles, assets, docs, version: app.getVersion(), appData: app.getPath('userData'),
        executable: process.execPath, architecture: process.arch,
        sandboxed,
        noSandbox: app.commandLine.hasSwitch('no-sandbox'),
      };
    });
    const executable = process.env.FACTORY_INSTALLED_EXECUTABLE;
    expect(await realpath(native.executable)).toBe(await realpath(executable));
    expect(native.root).toMatch(/\\resources\\app\.asar$/iu);
    expect(native.bundles).toEqual(['dist', 'docs', 'package.json']);
    expect(native.assets.some((asset) => asset.endsWith('.js'))).toBe(true);
    expect(native.docs).toEqual(['CLIENT_DELIVERY.md', 'MVP_GETTING_STARTED.md', 'WINDOWS_DISTRIBUTION.md']);
    expect(native).toMatchObject({
      version: expectedVersion, architecture: 'x64', sandboxed: true, noSandbox: false,
    });
    expect(await realpath(native.appData)).toBe(await realpath(join(process.env.APPDATA!, 'Software Factory Studio')));
    if (lifecycle === 'seed') {
      await instance.evaluate(({ dialog, app }) => {
        const path = process.getBuiltinModule('node:path')!;
        Object.assign(dialog, { showOpenDialog: async () => ({ canceled: false, filePaths: [path.dirname(app.getPath('exe'))] }) });
      });
      expect(await page.evaluate(() => window.studio?.projects.openFolder())).toEqual({ ok: false, error: 'PROJECT_UNAVAILABLE' });
      await instance.evaluate(({ dialog }, folder) => {
        Object.assign(dialog, { showOpenDialog: async () => ({ canceled: false, filePaths: [folder] }) });
      }, project);
      await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Client project café' })).toBeVisible();
      await page.getByRole('button', { name: 'Engineering Standards', exact: true }).click();
      const library = page.getByRole('region', { name: 'Engineering Profiles' });
      await library.getByRole('button', { name: 'Create new', exact: true }).click();
      await library.getByLabel('Name', { exact: true }).fill('Installer fixture profile');
      await library.getByLabel('Testing', { exact: true }).fill('Use disposable fixtures.');
      await library.getByRole('button', { name: 'Publish version', exact: true }).click();
      await expect(library.getByRole('status')).toContainText('Published immutable version 1.');
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('radio', { name: 'Dark' }).click();
      await expect(page.getByText('Preferences saved')).toBeVisible();
    } else {
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await page.getByText('Getting started', { exact: true }).press('Enter');
      await page.getByRole('button', { name: 'Check developer tools' }).click();
      const toolchain = page.getByLabel('Detected developer tools');
      if (restrictedTools) {
        await expect(toolchain.getByText('Not detected', { exact: true })).toHaveCount(4);
        await expect(page.getByRole('button', { name: 'New Project', exact: true })).toBeEnabled();
      } else {
        await expect(toolchain).toContainText(/Git\s*\d+\.\d+\.\d+/u);
        await expect(toolchain).toContainText(/Node\.js\s*22\.16\.0/u);
        await expect(toolchain).toContainText(/pnpm\s*10\.13\.1/u);
        await expect(toolchain).toContainText(/Go\s*1\.26\.11/u);
      }
      await page.screenshot({ path: test.info().outputPath(`installed-home-${lifecycle}.png`) });
      await page.getByRole('button', { name: 'View engineering standards' }).click();
      await expect(page.getByRole('region', { name: 'Engineering Profiles' })).toContainText('Installer fixture profile');
      const catalog = await page.evaluate(() => window.studio?.projects.list());
      expect(catalog).toMatchObject({ ok: true, value: { recents: [{ name: 'Client project café', directory: await realpath(project) }] } });
    }
    expect(await readFile(custom, 'utf8')).toBe('Client work survives Studio maintenance.\n');
    expect(await readdir(project)).toEqual(['client-owned.txt']);
  } finally {
    await instance.close();
  }
});
