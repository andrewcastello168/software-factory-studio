import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchStudio } from './launch';

const inventory = new URL('../../../../tests/fixtures/inventory.sql', import.meta.url);

test('native Database Studio generates an inventory starter and publishes an additive migration', async () => {
  test.setTimeout(90_000);
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'studio-native-schema-')));
  const profile = join(fixture, 'profile');
  const parent = join(fixture, 'projects');
  const project = join(parent, 'inventory-reference');
  let instance: ElectronApplication | undefined;
  try {
    await Promise.all([mkdir(profile), mkdir(parent)]);
    instance = await launchStudio(profile);
    await instance.evaluate(({ dialog, nativeTheme }, selected) => {
      nativeTheme.themeSource = 'dark';
      Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }),
        showMessageBox: async (_owner: unknown, options: { defaultId: number; detail: string }) => {
          if (options.defaultId !== 0 || !options.detail.includes('SHA-256')) throw new Error('Native operation needs a reviewed fingerprint.');
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
    await wizard.getByRole('textbox', { name: 'PostgreSQL DDL' }).fill(await readFile(inventory, 'utf8'));
    await wizard.getByRole('button', { name: 'Parse SQL' }).click();
    const frontend = wizard.getByRole('checkbox', { name: 'React page for products' });
    await expect(frontend).toBeDisabled();
    await wizard.getByRole('checkbox', { name: 'Backend API for products' }).check();
    await frontend.check();
    await wizard.getByRole('checkbox', { name: 'Backend API for categories' }).check();
    await wizard.getByRole('button', { name: 'Review Files' }).click();
    await expect(wizard.getByText('2 APIs · 1 React page', { exact: false })).toBeVisible();
    await wizard.getByRole('button', { name: 'db/migrations/0002_schema.sql' }).click();
    await expect(wizard.getByRole('region', { name: 'File preview' })).toContainText('FOREIGN KEY');
    await page.screenshot({ path: test.info().outputPath('new-project-schema-dark.png') });
    await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
    await expect(wizard.getByRole('heading', { name: 'Project files verified' })).toBeVisible();
    await wizard.getByRole('button', { name: 'Open Project', exact: true }).click();
    await page.getByRole('button', { name: 'Database Studio', exact: true }).click();
    const studio = page.getByRole('region', { name: 'Database Studio' });
    await expect(studio.getByText('Declared source schema')).toBeVisible();
    await studio.getByRole('button', { name: 'products', exact: true }).click();
    await expect(studio.getByRole('region', { name: 'Table products' }).getByRole('table').getByText('category_id', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('database-studio-designer-dark.png') });

    await studio.getByRole('button', { name: 'ERD', exact: true }).click();
    const canvas = studio.getByRole('region', { name: 'Entity relationship diagram' });
    await expect(canvas.locator('.schema-edge')).toHaveCount(4);
    const table = canvas.getByRole('button', { name: 'Select table products', exact: true });
    const before = await table.getAttribute('transform');
    await table.press('ArrowRight');
    await expect(table).not.toHaveAttribute('transform', before!);
    await canvas.getByRole('button', { name: 'Save Layout' }).click();
    await expect(studio.getByText('Diagram layout saved.')).toBeVisible();
    await instance.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: test.info().outputPath('database-studio-erd-light.png') });

    await studio.getByRole('button', { name: 'Schema', exact: true }).click();
    await studio.getByRole('button', { name: 'Import SQL', exact: true }).click();
    const importer = page.getByRole('dialog', { name: 'Review SQL Import' });
    await importer.getByRole('textbox', { name: 'PostgreSQL DDL' }).fill('DROP TABLE products;');
    await importer.getByRole('button', { name: 'Parse SQL' }).click();
    const rejected = page.getByRole('dialog', { name: 'Migration Review' });
    await expect(rejected.getByRole('alert')).toContainText('Unsupported statement');
    await rejected.getByRole('button', { name: 'Close', exact: true }).click();

    await studio.getByRole('button', { name: 'Add Column', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Add Column' });
    await editor.getByRole('textbox', { name: 'Column name' }).fill('description');
    await editor.getByRole('button', { name: 'Save Column' }).click();
    await studio.getByRole('button', { name: 'Preview Migration' }).click();
    const review = page.getByRole('dialog', { name: 'Migration Review' });
    await expect(review.locator('pre')).toContainText('ADD COLUMN "description" text');
    await review.getByRole('button', { name: 'Publish Migration' }).click();
    await expect(studio.getByText('Migration published and verified.')).toBeVisible();
    expect(await readFile(join(project, 'db', 'migrations', '0003_schema.sql'), 'utf8')).toContain('ADD COLUMN "description" text');
    expect(await page.evaluate(() => Reflect.apply(window.studio!.schema.inspect, null, ['../outside'])))
      .toEqual({ ok: false, error: 'INVALID_REQUEST' });
  } finally {
    await instance?.close();
    await rm(fixture, { recursive: true, force: true, maxRetries: 4 });
  }
});
