import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchStudio } from './launch';


test('browses the Go catalog and generates an approved Go workspace with schema and React CRUD', async () => {
  test.setTimeout(90_000);
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'studio-go-stack-')));
  const profile = join(fixture, 'profile');
  const folder = join(fixture, 'projects');
  let app: ElectronApplication | undefined;
  try {
    await Promise.all([mkdir(profile), mkdir(folder)]);
    app = await launchStudio(profile);
    await app.evaluate(({ dialog, nativeTheme }, destination) => {
      nativeTheme.themeSource = 'light';
      Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [destination] }),
        showMessageBox: async (_owner: unknown, options: { defaultId: number; detail: string }) => {
          if (options.defaultId !== 0 || !options.detail.includes('SHA-256')) throw new Error('Expected reviewed files.');
          return { response: 1 };
        },
      });
    }, folder);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Technology Catalog', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Go · Gin · React/u })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Node.js · TypeScript/u })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('technology-catalog-stacks.png') });

    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'New Project' });
    await wizard.getByRole('textbox', { name: 'Project name', exact: true }).fill('Go Inventory');
    await wizard.getByRole('button', { name: 'Choose Folder', exact: true }).click();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await wizard.getByRole('checkbox', { name: 'Authentication', exact: true }).check();
    await wizard.getByRole('combobox', { name: 'Technology stack' }).selectOption('go-gin-react-postgres');
    await expect(wizard.getByRole('combobox', { name: 'Architecture profile' })).toHaveValue('go-service');
    await expect(wizard.getByText(/Audit Logging are unavailable for Go/u)).toBeVisible();
    await wizard.getByRole('combobox', { name: 'UI template' }).selectOption({ label: 'Business Workspace · v1' });
    await wizard.getByRole('checkbox', { name: /Define a database schema/u }).check();
    await wizard.getByText('Import PostgreSQL DDL', { exact: true }).click();
    await wizard.getByRole('textbox', { name: 'PostgreSQL DDL' }).fill('CREATE TABLE supplies (id integer PRIMARY KEY, name text NOT NULL);');
    await wizard.getByRole('button', { name: 'Parse SQL' }).click();
    await wizard.getByRole('checkbox', { name: 'Backend API for supplies' }).check();
    await wizard.getByRole('checkbox', { name: 'React page for supplies' }).check();
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await wizard.getByRole('button', { name: 'Review Files', exact: true }).click();
    await expect(wizard.getByText(/Go Service · v1 · Foundation/u)).toBeVisible();
    await wizard.getByRole('button', { name: 'go.mod', exact: true }).click();
    await expect(wizard.getByRole('region', { name: 'File preview' })).toContainText('github.com/gin-gonic/gin v1.12.0');
    await page.screenshot({ path: test.info().outputPath('new-project-go-review.png') });
    await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
    await wizard.getByRole('button', { name: 'Open Project', exact: true }).click({ timeout: 15_000 });
    const project = join(folder, 'go-inventory');
    expect(await readFile(join(project, 'internal', 'records', 'tables.go'), 'utf8')).toContain('"supplies"');
    expect(await readFile(join(project, '.factory', 'versions.lock.json'), 'utf8')).toContain('"go-gin-react-postgres"');
    await page.getByRole('button', { name: 'Database Studio', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Database Studio', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Generation Review', exact: true }).click();
    const review = page.getByRole('region', { name: 'Generation Review', exact: true });
    await expect(review.getByText(/Go Service · v1/u)).toBeVisible();
    await expect(review.getByRole('checkbox', { name: 'API for supplies', exact: true })).toBeDisabled();
    await expect(review.getByText('Install optional modules', { exact: true })).toHaveCount(0);
  } finally {
    await app?.close();
    await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
  }
});
