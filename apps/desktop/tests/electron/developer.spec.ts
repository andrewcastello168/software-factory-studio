import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
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
        showSaveDialog: async () => ({ canceled: false, filePath: destination + '/reviewed-openapi.json' }),
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
    await wizard.getByRole('checkbox', { name: /Define a database schema/u }).check();
    await wizard.getByText('Import PostgreSQL DDL', { exact: true }).click();
    await wizard.getByRole('textbox', { name: 'PostgreSQL DDL' }).fill('CREATE TABLE supplies (id integer PRIMARY KEY, name text NOT NULL);');
    await wizard.getByRole('button', { name: 'Parse SQL' }).click();
    await wizard.getByRole('checkbox', { name: 'Backend API for supplies' }).check();
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
    await page.getByRole('button', { name: 'Preview OpenAPI' }).click();
    await expect(page.getByRole('textbox', { name: 'OpenAPI export' })).toHaveValue(/\/api\/health/u);
    await page.getByRole('button', { name: 'Export OpenAPI JSON' }).click();
    await expect(page.getByText('OpenAPI exported.')).toBeVisible();
    expect(JSON.parse(await readFile(join(projects, 'reviewed-openapi.json'), 'utf8'))).toMatchObject({
      openapi: '3.1.0', paths: { '/api/health': { get: { summary: 'API health' } } },
    });
    await page.getByRole('button', { name: 'Open Request' }).click();
    await expect(page.getByRole('textbox', { name: 'Endpoint path', exact: true })).toHaveValue('/api/health');
    await expect(page.getByRole('button', { name: 'Review and Send' })).toBeDisabled();
    const reservation = createServer();
    await new Promise<void>((done) => reservation.listen(0, '127.0.0.1', done));
    const address = reservation.address();
    if (!address || typeof address === 'string') throw new Error('Expected a disposable TCP port.');
    await new Promise<void>((done) => reservation.close(() => done()));
    await writeFile(join(project, '.env'), 'PORT=' + address.port + '\n', { flag: 'wx' });
    // Exercise live IPC with a disposable HTTP process. The standalone suite
    // separately exercises the unmodified generated Express and Gin backends.
    await writeFile(join(project, 'server', 'server.ts'), `
import { createServer } from 'node:http';
const port = Number(process.env.PORT);
createServer((request, response) => {
  response.writeHead(request.url === '/api/health' ? 200 : 404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ status: 'fixture-ready' }));
}).listen(port, '127.0.0.1', () => console.log(JSON.stringify({ event: 'listening', port })));
`);
    await page.getByRole('button', { name: 'Runtime', exact: true }).click();
    await page.getByRole('button', { name: 'Review Command' }).click();
    await page.getByRole('button', { name: 'Approve and Run' }).click();
    await expect(page.locator('.dev-process-list')).toContainText('listening');
    await page.getByRole('button', { name: 'API Playground', exact: true }).click();
    await page.getByRole('button', { name: 'Review and Send' }).click();
    await expect(page.getByText('{"status":"fixture-ready"}', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('developer-playground-light.png') });
    await page.getByRole('button', { name: 'Runtime', exact: true }).click();
    await page.getByRole('button', { name: 'Stop Backend' }).click();
    await expect(page.locator('.dev-process-list')).toContainText('stopped');

    await page.getByRole('button', { name: 'Page Designer', exact: true }).click();
    await page.getByRole('textbox', { name: 'Design ID' }).fill('status');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Operations status');
    await page.getByRole('combobox', { name: 'Data source' }).selectOption('health');
    const vite = join(project, 'vite.config.ts');
    const originalConfig = await readFile(vite, 'utf8');
    await writeFile(vite, originalConfig + '\n// External Vite customization\n');
    await page.getByRole('button', { name: 'Review Page Generation' }).click();
    await expect(page.getByText(/unchanged Vite configuration/u)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve and Apply' })).toBeDisabled();
    expect(await readFile(vite, 'utf8')).toContain('External Vite customization');
    await writeFile(vite, originalConfig);
    await page.getByRole('button', { name: 'Review Page Generation' }).click();
    await page.getByRole('button', { name: 'web/features/StudioPage.tsx', exact: true }).click();
    await expect(page.locator('.incremental-preview')).toContainText('BusinessShell');
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const workspace = page.locator('#workspace-main');
    expect(await workspace.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await page.getByRole('heading', { name: 'Generation review', exact: true })
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: test.info().outputPath('developer-page-review-dark.png') });
    await page.getByRole('button', { name: 'Approve and Apply' }).click();
    await expect(page.getByText('Reviewed design saved.')).toBeVisible();
    expect(await readFile(join(project, 'web', 'features', 'StudioPage.tsx'), 'utf8')).toContain('/api/health');

    await page.getByRole('button', { name: 'Requirements', exact: true }).click();
    await page.getByRole('textbox', { name: 'Design ID' }).fill('verify-operations');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Verify operations');
    await page.getByRole('textbox', { name: 'Acceptance criteria' }).fill('The workspace shows the current backend status.');
    await page.getByRole('textbox', { name: 'Artifact references' }).fill('page=status\napi=health\ntable=supplies\nsource=web/main.tsx');
    await page.getByRole('button', { name: 'Review Save' }).click();
    await page.getByRole('button', { name: 'Approve and Apply' }).click();
    await expect(page.getByText('Reviewed design saved.')).toBeVisible();
    await page.getByRole('button', { name: 'table: supplies', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Database Studio', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Developer Tools', exact: true }).click();
    await page.getByRole('button', { name: 'Requirements', exact: true }).click();
    await page.getByRole('button', { name: 'New Workflow', exact: true }).click();
    await page.getByRole('textbox', { name: 'Design ID' }).fill('operations-review');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Operations review');
    await page.getByRole('textbox', { name: 'Step title' }).fill('Review current stock');
    await page.getByRole('textbox', { name: 'Step references' }).fill('requirement=verify-operations');
    await page.getByRole('button', { name: 'Review Save' }).click();
    await page.getByRole('button', { name: 'Approve and Apply' }).click();
    await expect(page.getByRole('button', { name: 'Operations review', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'requirement: verify-operations', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Design ID' })).toHaveValue('verify-operations');

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
