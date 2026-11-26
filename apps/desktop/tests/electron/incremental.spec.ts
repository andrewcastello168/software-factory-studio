import { mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

const executablePath = createRequire(import.meta.url)('electron') as string;
const externalDdl = new URL('../../../../tests/fixtures/suppliers.sql', import.meta.url);

test('reviews incremental files in the built workbench and preserves the supplier migration and custom service', async () => {
  test.setTimeout(90_000);
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'studio-native-incremental-')));
  const profile = join(fixture, 'profile');
  const parent = join(fixture, 'projects');
  const project = join(parent, 'inventory-reference');
  let instance: ElectronApplication | undefined;
  try {
    await Promise.all([mkdir(profile), mkdir(parent)]);
    instance = await _electron.launch({
      executablePath, args: [resolve('.'), '--user-data-dir=' + profile],
      env: { ...process.env, FACTORY_DESKTOP_DEV: '0' }, chromiumSandbox: true,
    });
    await instance.evaluate(({ dialog, nativeTheme }, selected) => {
      nativeTheme.themeSource = 'dark';
      let denyIncremental = true;
      Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }),
        showMessageBox: async (_owner: unknown, options: { title: string; defaultId: number; detail: string }) => {
          if (options.defaultId !== 0 || !options.detail.includes('SHA-256')) throw new Error('Expected reviewed authorization.');
          if (options.title === 'Apply reviewed generation?' && denyIncremental) {
            denyIncremental = false;
            return { response: 0 };
          }
          return { response: 1 };
        },
      });
    }, parent);
    const page = await instance.firstWindow();
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'New Project' });
    await wizard.getByRole('textbox', { name: 'Project name', exact: true }).fill('Inventory Reference');
    await wizard.getByRole('button', { name: 'Choose Folder' }).click();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await wizard.getByRole('checkbox', { name: /Define a database schema/u }).check();
    await wizard.getByText('Import PostgreSQL DDL', { exact: true }).click();
    await wizard.getByRole('textbox', { name: 'PostgreSQL DDL' }).fill('CREATE TABLE products (id integer PRIMARY KEY, name text NOT NULL);');
    await wizard.getByRole('button', { name: 'Parse SQL' }).click();
    await wizard.getByRole('checkbox', { name: 'Backend API for products' }).check();
    await wizard.getByRole('checkbox', { name: 'React page for products' }).check();
    await wizard.getByRole('button', { name: 'Review Files' }).click();
    await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
    await wizard.getByRole('button', { name: 'Open Project', exact: true }).click();

    const customPath = join(project, 'server/features/crud/service.ts');
    const custom = (await readFile(customPath, 'utf8')) + '\n// Preserve client approval logic.\n';
    await writeFile(customPath, custom);
    const migration = await readFile(externalDdl, 'utf8');
    await writeFile(join(project, 'db/migrations/0003_suppliers.sql'), migration, { flag: 'wx' });
    await page.getByRole('button', { name: 'Generation Review', exact: true }).press('Enter');
    const review = page.getByRole('region', { name: 'Generation Review', exact: true });
    await review.getByRole('checkbox', { name: 'API for suppliers', exact: true }).check();
    await review.getByRole('checkbox', { name: 'React page for suppliers', exact: true }).check();
    await review.getByRole('button', { name: 'Preview Changes', exact: true }).click();
    const plan = review.getByRole('region', { name: 'Planned changes' });
    await expect(plan).toBeVisible();
    await expect(plan.getByRole('button', { name: /service\.ts Protected/u })).toBeVisible();
    await plan.getByRole('button', { name: /contracts\.ts Modify/u }).click();
    await expect(plan.getByRole('region', { name: 'After', exact: true })).toContainText('Row_suppliers');
    await page.screenshot({ path: test.info().outputPath('generation-review-dark.png') });
    await instance.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: test.info().outputPath('generation-review-light.png') });

    const apply = plan.getByRole('button', { name: 'Apply Generation', exact: true });
    await apply.click();
    await expect(apply).toBeEnabled();
    expect(await readFile(join(project, 'server/features/crud/contracts.ts'), 'utf8')).not.toContain('Row_suppliers');
    await apply.click();
    await expect(review.getByText('Generation result verified.', { exact: false })).toBeVisible();
    expect(await readFile(join(project, 'server/features/crud/contracts.ts'), 'utf8')).toContain('Row_suppliers');
    expect(await readFile(customPath, 'utf8')).toBe(custom);
    expect(await readFile(join(project, 'db/migrations/0003_suppliers.sql'), 'utf8')).toBe(migration);
    expect(await readdir(join(project, 'db/migrations'))).toHaveLength(3);
    await review.getByRole('button', { name: 'Preview Changes', exact: true }).click();
    await expect(review.getByText(/0 writes · SHA-256/u)).toBeVisible();
    await expect(review.getByRole('button', { name: 'Apply Generation', exact: true })).toBeDisabled();
    await review.getByRole('button', { name: 'History', exact: true }).click();
    await expect(review.getByRole('region', { name: 'Generation history' })).toContainText('Applied');

    await review.getByRole('button', { name: 'Review plan', exact: true }).click();
    await review.getByText('Install optional modules', { exact: true }).click();
    await review.getByRole('checkbox', { name: 'Install User management', exact: true }).check();
    const previewModule = review.getByRole('button', { name: 'Preview Module Installation' });
    await previewModule.click();
    await expect(plan.getByRole('alert')).toContainText('requires authentication');
    await review.getByRole('checkbox', { name: 'Install Authentication', exact: true }).check();
    await previewModule.click();
    await expect(plan).toContainText('authentication v1.0.0');
    await expect(plan).toContainText('0004_authentication.sql');
    await expect(apply).toBeEnabled();
    await page.screenshot({ path: test.info().outputPath('generation-review-module-install.png') });
    await apply.click();
    await expect(review.getByText('Generation result verified.', { exact: false })).toBeVisible();
    await expect(review.getByRole('checkbox', { name: 'Install Authentication', exact: true })).toBeDisabled();
    expect(await readFile(customPath, 'utf8')).toBe(custom);
    expect(await readFile(join(project, 'db/migrations/0003_suppliers.sql'), 'utf8')).toBe(migration);
    expect(await readdir(join(project, 'db/migrations'))).toHaveLength(4);
  } finally {
    await instance?.close();
    await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
  }
});
