import { cp, mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchStudio } from './launch';


test('publishes a profile and previews a pinned, branded project with identity modules', async () => {
  test.setTimeout(90_000);
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'studio-native-library-')));
  const profile = join(fixture, 'profile');
  const folder = join(fixture, 'projects');
  const retained = process.env.FACTORY_INSTALLED_FIXTURES;
  const project = join(folder, retained ? 'inventory-portal' : 'client-inventory');
  let app: ElectronApplication | undefined;
  try {
    await Promise.all([mkdir(profile), mkdir(folder)]);
    app = await launchStudio(profile);
    await app.evaluate(({ dialog, nativeTheme }, path) => {
      nativeTheme.themeSource = 'dark';
      Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [path] }),
        showMessageBox: async (_owner: unknown, options: { defaultId: number; detail: string }) => {
          if (options.defaultId !== 0 || !options.detail.includes('SHA-256')) throw new Error('Expected a reviewed fingerprint.');
          return { response: 1 };
        },
      });
    }, folder);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Engineering Standards', exact: true }).click();
    const library = page.getByRole('region', { name: 'Engineering Profiles' });
    await library.getByRole('button', { name: 'Create new', exact: true }).click();
    await library.getByLabel('Name', { exact: true }).fill('Client Engineering');
    await library.getByLabel('Testing', { exact: true }).fill('Use disposable PostgreSQL schemas.');
    await library.getByRole('button', { name: 'Publish version', exact: true }).click();
    await expect(library.getByRole('status')).toContainText('Published immutable version 1.');
    await page.screenshot({ path: test.info().outputPath('engineering-library-profile.png') });

    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'New Project' });
    await wizard.getByRole('textbox', { name: 'Project name', exact: true }).fill(retained ? 'Inventory Portal' : 'Client Inventory');
    await wizard.getByRole('button', { name: 'Choose Folder', exact: true }).click();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await wizard.getByRole('combobox', { name: 'Engineering profile' }).selectOption({ label: 'Client Engineering · v1' });
    await wizard.getByRole('combobox', { name: 'UI template' }).selectOption({ label: 'Business Workspace · v1' });
    await wizard.getByLabel('Brand mark').fill('CI');
    await wizard.getByRole('checkbox', { name: 'RBAC', exact: true }).check();
    await expect(wizard.getByRole('alert')).toContainText('RBAC requires');
    await wizard.getByRole('checkbox', { name: 'Authentication', exact: true }).check();
    await wizard.getByRole('checkbox', { name: 'User management', exact: true }).check();
    await wizard.getByRole('checkbox', { name: 'Audit logging', exact: true }).check();
    if (retained) {
      await wizard.getByRole('checkbox', { name: /Define a database schema/u }).check();
      await wizard.getByText('Import PostgreSQL DDL', { exact: true }).click();
      const inventory = await readFile(new URL('../../../../tests/fixtures/inventory.sql', import.meta.url), 'utf8');
      await wizard.getByRole('textbox', { name: 'PostgreSQL DDL' }).fill(inventory);
      await wizard.getByRole('button', { name: 'Parse SQL' }).click();
      for (const table of ['categories', 'products', 'stock_movements', 'suppliers', 'warehouses']) {
        await wizard.getByRole('checkbox', { name: 'Backend API for ' + table, exact: true }).check();
        await wizard.getByRole('checkbox', { name: 'React page for ' + table, exact: true }).check();
      }
    }
    await wizard.getByRole('button', { name: 'Review Files', exact: true }).click();
    await wizard.getByRole('button', { name: 'docs/IDENTITY.md', exact: true }).click();
    await expect(wizard.getByRole('region', { name: 'File preview' })).toContainText('bootstrap');
    await page.screenshot({ path: test.info().outputPath('new-project-mvp-review.png') });
    await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
    await expect(wizard.getByRole('heading', { name: 'Project files verified' })).toBeVisible({ timeout: 15_000 });
    expect(await readFile(join(project, 'docs', 'ENGINEERING_PROFILE.md'), 'utf8')).toContain('Use disposable PostgreSQL schemas.');
    expect(await readFile(join(project, '.factory', 'versions.lock.json'), 'utf8')).toContain('"id": "authentication"');
    expect(await readFile(join(project, 'web/features/business/BusinessShell.tsx'), 'utf8')).toContain('"CI"');
    if (retained) await cp(project, join(retained, 'node'), { recursive: true, force: false, errorOnExist: true });
  } finally {
    await app?.close();
    await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
  }
});
