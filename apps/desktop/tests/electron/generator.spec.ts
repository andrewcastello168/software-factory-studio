import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

const executablePath = createRequire(import.meta.url)('electron') as string;

test('native New Project opens a verified managed starter after the reviewed approval', async () => {
  test.setTimeout(60_000);
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'studio-native-generator-')));
  const profile = join(fixture, 'profile');
  const parent = join(fixture, 'Client Projects café');
  const project = join(parent, 'inventory-portal');
  let instance: ElectronApplication | undefined;
  try {
    await Promise.all([mkdir(profile), mkdir(parent)]);
    instance = await _electron.launch({
      executablePath,
      args: [resolve('.'), '--user-data-dir=' + profile],
      env: { ...process.env, FACTORY_DESKTOP_DEV: '0' },
      chromiumSandbox: true,
    });
    await instance.evaluate(({ dialog, nativeTheme }, selected) => {
      nativeTheme.themeSource = 'light';
      let prompts = 0;
      Object.assign(dialog, {
        showOpenDialog: async (_owner: unknown, options: { properties: string[] }) => {
          if (!options.properties.includes('openDirectory')) throw new Error('Expected native directory authorization.');
          return { canceled: false, filePaths: [selected] };
        },
        showMessageBox: async (_owner: unknown, options: { defaultId: number; detail: string }) => {
          if (options.defaultId !== 0 || !options.detail.includes('Plan SHA-256:')) throw new Error('Expected a reviewed native confirmation.');
          return { response: prompts++ === 0 ? 0 : 1 };
        },
      });
    }, parent);
    const page = await instance.firstWindow();
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'New Project' });
    await wizard.getByRole('textbox', { name: 'Project name', exact: true }).fill('Inventory Portal');
    await wizard.getByRole('button', { name: 'Choose Folder', exact: true }).click();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(wizard.getByRole('combobox', { name: 'Engineering profile' })).toContainText('Standard Engineering');
    const example = wizard.getByRole('checkbox', { name: 'Welcome example' });
    await expect(example).not.toBeChecked();
    await wizard.getByText('Planned options', { exact: true }).click();
    await expect(wizard.getByRole('list', { name: 'Planned optional modules' })).toContainText('Authentication');
    await page.screenshot({ path: test.info().outputPath('new-project-modules-light.png') });
    await wizard.getByRole('button', { name: 'Review Files' }).click();
    await expect(wizard.getByRole('heading', { name: 'Review generation plan' })).toBeVisible();
    await expect(wizard.getByRole('region', { name: 'File preview' })).toContainText('Standard Engineering profile v1');
    await expect(wizard.getByText('Foundation only')).toBeVisible();
    await expect(wizard.getByRole('button', { name: 'db/migrations/0002_welcome.sql', exact: true })).toHaveCount(0);
    expect(await readdir(parent)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('new-project-review-light.png') });
    await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
    await expect(wizard.getByRole('heading', { name: 'Stack and profiles' })).toBeVisible();
    expect(await readdir(parent)).toEqual([]);
    await instance.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await example.check();
    await wizard.getByRole('button', { name: 'Review Files' }).click();
    await expect(wizard.getByRole('heading', { name: 'Review generation plan' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await wizard.getByRole('button', { name: 'db/migrations/0002_welcome.sql', exact: true }).click();
    await expect(wizard.getByRole('region', { name: 'File preview' })).toContainText('CREATE TABLE welcome_messages');
    await page.screenshot({ path: test.info().outputPath('new-project-review-dark.png') });
    expect(await page.evaluate(() => Reflect.apply(window.studio!.generator.preview, null, [{ destination: '../outside' }])))
      .toEqual({ ok: false, error: 'INVALID_REQUEST' });

    await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
    await expect(wizard.getByRole('heading', { name: 'Project files verified' })).toBeVisible();
    const manifest = JSON.parse(await readFile(join(project, '.factory', 'generation-manifest.json'), 'utf8')) as {
      files: { path: string; sha256: string }[];
    };
    expect(manifest.files.length).toBeGreaterThan(20);
    for (const file of manifest.files) {
      expect(createHash('sha256').update(await readFile(join(project, file.path))).digest('hex')).toBe(file.sha256);
    }
    expect(await readdir(project)).not.toContain('node_modules');
    expect(JSON.parse(await readFile(join(project, '.factory', 'modules.json'), 'utf8')))
      .toMatchObject({ installed: [{ id: 'welcome-example', version: '1.0.0', requires: [] }] });
    await wizard.getByRole('button', { name: 'Open Project', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Inventory Portal' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Managed project', { exact: true })).toBeVisible();
  } finally {
    await instance?.close();
    await rm(fixture, { recursive: true, force: true, maxRetries: 4 });
  }
});
