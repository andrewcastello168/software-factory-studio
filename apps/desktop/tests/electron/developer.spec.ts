import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

const executablePath = createRequire(import.meta.url)('electron') as string;

test('reviews a real application command, saves API and page designs, and traces source changes', async () => {
  test.setTimeout(100_000);
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'factory phase 10-')));
  const profile = join(folder, 'profile');
  const projects = join(folder, 'projects');
  let app: ElectronApplication | undefined;
  try {
    await Promise.all([mkdir(profile), mkdir(projects)]);
    app = await _electron.launch({
      executablePath, args: [resolve('.'), '--user-data-dir=' + profile],
      env: { ...process.env, FACTORY_DESKTOP_DEV: '0' }, chromiumSandbox: true,
    });
    await app.evaluate(({ dialog, nativeTheme }, destination) => {
      nativeTheme.themeSource = 'light';
      Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [destination] }),
        showMessageBox: async (_owner: unknown, options: { defaultId: number; detail: string }) => {
          if (options.defaultId !== 0 || !options.detail.includes(destination)) throw new Error('Worktree review is missing.');
          return { response: 1 };
        },
      });
    }, projects);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'New Project', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'New Project' });
    await wizard.getByRole('textbox', { name: 'Project name', exact: true }).fill('Workflow Desk');
    await wizard.getByRole('button', { name: 'Choose Folder', exact: true }).click();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await wizard.getByRole('combobox', { name: 'UI template' }).selectOption({ label: 'Business Workspace · v1' });
    await wizard.getByRole('button', { name: 'Review Files', exact: true }).click();
    await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
    await wizard.getByRole('button', { name: 'Open Project', exact: true }).click();
    const project = join(projects, 'workflow-desk');

    await page.getByRole('button', { name: 'Developer Tools', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Editor and terminal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review Command', exact: true })).toBeEnabled({ timeout: 12_000 });
    await page.getByRole('button', { name: 'Review Command', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Command preview' })).toBeVisible();
    await expect(page.locator('.dev-review pre')).toContainText('server/server.ts');
    await page.screenshot({ path: test.info().outputPath('developer-runtime-light.png') });

    await page.getByRole('button', { name: 'API Designer', exact: true }).click();
    const health = page.locator('.dev-artifact-list li').filter({ hasText: '/api/health' });
    await health.getByRole('button', { name: 'Use Definition' }).click();
    await page.getByRole('button', { name: 'Review Save' }).click();
    await page.getByRole('button', { name: 'Approve and Apply' }).click();
    await expect(page.getByText('Reviewed design saved.')).toBeVisible();
    await expect(page.getByText('api · implemented')).toBeVisible();
    await page.getByRole('button', { name: 'Open Request' }).click();
    await expect(page.getByRole('textbox', { name: 'Endpoint path', exact: true })).toHaveValue('/api/health');
    await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();

    await page.getByRole('button', { name: 'Page Designer', exact: true }).click();
    await page.getByRole('textbox', { name: 'Design ID' }).fill('status');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Operations status');
    await page.getByRole('combobox', { name: 'Data source' }).selectOption('health');
    await page.getByRole('button', { name: 'Review Page Generation' }).click();
    await page.getByRole('button', { name: 'web/features/StudioPage.tsx', exact: true }).click();
    await expect(page.locator('.incremental-preview')).toContainText('BusinessShell');
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: test.info().outputPath('developer-page-review-dark.png') });
    await page.getByRole('button', { name: 'Approve and Apply' }).click();
    await expect(page.getByText('Reviewed design saved.')).toBeVisible();
    expect(await readFile(join(project, 'web', 'features', 'StudioPage.tsx'), 'utf8')).toContain('/api/health');

    await page.getByRole('button', { name: 'Requirements', exact: true }).click();
    await page.getByRole('textbox', { name: 'Design ID' }).fill('verify-operations');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Verify operations');
    await page.getByRole('textbox', { name: 'Acceptance criteria' }).fill('The workspace shows the current backend status.');
    await page.getByRole('textbox', { name: 'Artifact references' }).fill('page=status\napi=health\nsource=web/main.tsx');
    await page.getByRole('button', { name: 'Review Save' }).click();
    await page.getByRole('button', { name: 'Approve and Apply' }).click();
    await expect(page.getByText('Reviewed design saved.')).toBeVisible();
    const main = join(project, 'web', 'main.tsx');
    await writeFile(main, await readFile(main, 'utf8') + '\n// External edit\n');
    await page.getByRole('button', { name: 'Refresh Artifacts' }).click();
    await expect(page.locator('.dev-artifact-list')).toContainText('changed');
    await page.screenshot({ path: test.info().outputPath('developer-traceability-dark.png') });
  } finally {
    await app?.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 5 });
  }
});
