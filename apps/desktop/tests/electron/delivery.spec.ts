import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { launchStudio } from './launch';


test('inspects owned source, applies reviewed deployment files, and runs real quality checks with stale evidence', async () => {
  test.setTimeout(120_000);
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'studio-delivery-')));
  const profile = join(folder, 'profile');
  const projects = join(folder, 'projects');
  let app: ElectronApplication | undefined;
  try {
    await Promise.all([mkdir(profile), mkdir(projects)]);
    app = await launchStudio(profile);
    await app.evaluate(({ dialog, nativeTheme }, destination) => {
      nativeTheme.themeSource = 'dark';
      Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [destination] }),
        showMessageBox: async (_owner: unknown, options: { defaultId: number; detail: string }) => {
          if (options.defaultId !== 0 || !options.detail.includes(destination)) throw new Error('A worktree review is required.');
          return { response: 1 };
        },
      });
    }, projects);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'New Project' });
    await wizard.getByRole('textbox', { name: 'Project name', exact: true }).fill('Delivery Desk');
    await wizard.getByRole('button', { name: 'Choose Folder', exact: true }).click();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await wizard.getByRole('button', { name: 'Review Files', exact: true }).click();
    await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
    await wizard.getByRole('button', { name: 'Open Project', exact: true }).click();
    const project = join(projects, 'delivery-desk');

    await page.getByRole('button', { name: 'Client Delivery', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Source and standards' })).toBeVisible();
    await expect(page.getByText('Pinned stack and engine locks are recognized.')).toBeVisible();
    await expect(page.getByText('No missing or modified owned files were found.')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('delivery-inspector-dark.png') });

    await page.getByRole('button', { name: 'Deployment', exact: true }).click();
    await page.getByRole('button', { name: 'Review CI Template', exact: true }).click();
    await expect(page.getByRole('button', { name: '.github/workflows/factory-verification.yml', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Approve and Apply', exact: true }).click();
    await expect(page.getByText('Reviewed delivery files written.')).toBeVisible();
    const workflow = join(project, '.github', 'workflows', 'factory-verification.yml');
    expect(await readFile(workflow, 'utf8')).toContain('persist-credentials: false');
    await writeFile(workflow, '# Custom CI configuration\n');
    await page.getByRole('button', { name: 'Review CI Template', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Approve and Apply', exact: true })).toBeDisabled();
    await expect(page.getByText(/Resolve existing delivery files/u)).toBeVisible();
    expect(await readFile(workflow, 'utf8')).toBe('# Custom CI configuration\n');

    const testFile = join(project, 'test', 'http.test.ts');
    await writeFile(testFile, "import { test } from 'node:test';\ntest('fixture', () => { throw new Error('Intentional fixture failure'); });\n");
    await page.getByRole('button', { name: 'Quality Center', exact: true }).click();
    const check = page.locator('li').filter({ has: page.getByRole('button', { name: 'Review Tests', exact: true }) });
    async function runCheck() {
      await page.getByRole('button', { name: 'Review Tests', exact: true }).click();
      await page.getByRole('button', { name: 'Approve and Run Check', exact: true }).click();
    }
    await runCheck();
    await expect(check).toContainText('failed', { timeout: 15_000 });
    await expect(page.locator('.dev-output')).toContainText('Intentional fixture failure');
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: test.info().outputPath('delivery-quality-light.png') });

    await writeFile(testFile, "import { test } from 'node:test';\ntest('fixture', () => {});\n");
    await page.getByRole('button', { name: 'Refresh Evidence', exact: true }).click();
    await expect(check).toContainText('Stale');
    await runCheck();
    await expect(check).toContainText('passed', { timeout: 15_000 });
    await page.getByRole('button', { name: 'Release Center', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Review Release Archive', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Project History', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Checks and artifacts' })).toBeVisible();
    await expect(page.getByText(/Tests · passed/u)).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('delivery-history-light.png') });
  } finally {
    await app?.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});
