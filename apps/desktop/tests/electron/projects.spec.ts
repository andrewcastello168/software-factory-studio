import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';

const require = createRequire(import.meta.url);
const executablePath = require('electron') as string;

async function useFolderSelection(instance: ElectronApplication, folder: string) {
  await instance.evaluate(({ dialog }, submitted) => {
    Object.assign(dialog, {
      showOpenDialog: async (_owner: unknown, options: { properties: string[] }) => {
        if (!options.properties.includes('openDirectory')) throw new Error('Expected the native directory chooser.');
        return { canceled: false, filePaths: [submitted] };
      },
    });
  }, folder);
}

test('native project flow opens, refreshes, relocates and remembers real folders', async () => {
  const testInfo = test.info();
  const fixture = await mkdtemp(join(tmpdir(), 'factory-native-projects-'));
  const profile = join(fixture, 'profile');
  const project = join(fixture, 'Project café');
  const second = join(fixture, 'Second Project');
  const outside = join(fixture, 'Outside');
  const moved = join(fixture, 'Moved project');
  const code = 'export const answer = 42;\n';
  let instance: ElectronApplication | undefined;

  async function launch() {
    instance = await _electron.launch({
      executablePath,
      args: [resolve('.'), `--user-data-dir=${profile}`],
      env: { ...process.env, FACTORY_DESKTOP_DEV: '0' },
      chromiumSandbox: true,
    });
    expect(await realpath(await instance.evaluate(({ app }) => app.getPath('userData')))).toBe(await realpath(profile));
    return instance;
  }

  try {
    await Promise.all([mkdir(join(project, 'src'), { recursive: true }), mkdir(second), mkdir(outside), mkdir(profile)]);
    await mkdir(join(project, '.factory'));
    await writeFile(join(project, 'src', 'index.ts'), code);
    const metadata = '{"version":1,"id":"02b192a8-b874-4423-9add-af527064998f","name":"Managed café","stackId":"example"}';
    await writeFile(join(project, '.factory', 'project.json'), metadata);
    await writeFile(join(outside, 'secret.txt'), 'outside project');
    await symlink(outside, join(project, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = await readdir(project);

    const first = await launch();
    await useFolderSelection(first, project);
    const page = await first.firstWindow();
    await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Project Overview' })).toBeVisible();
    await expect(page.getByText('Managed project', { exact: true })).toBeVisible();
    const tab = page.getByRole('tab', { name: 'Managed café' });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    const id = (await tab.getAttribute('id'))?.replace('workspace-tab-', '');
    if (!id) throw new Error('Project tab token was not shown.');

    const rejected = await page.evaluate(async () => {
      const endpoint = window.studio!.projects;
      return [await endpoint.rescan('../Outside'), await endpoint.rescan('02b192a8-b874-4423-9add-af527064998f')];
    });
    expect(rejected).toEqual([{ ok: false, error: 'INVALID_REQUEST' }, { ok: false, error: 'ACCESS_DENIED' }]);
    expect(await readdir(project)).toEqual(before);
    expect(await readFile(join(project, 'src', 'index.ts'), 'utf8')).toBe(code);
    expect(await readFile(join(project, '.factory', 'project.json'), 'utf8')).toBe(metadata);
    await page.screenshot({ path: testInfo.outputPath('project-overview.png') });

    await page.getByRole('button', { name: 'Browse files' }).click();
    await page.getByRole('button', { name: 'src', exact: true }).click();
    await expect(page.getByText('index.ts', { exact: true })).toBeVisible();
    await expect(page.getByText('Link skipped')).toBeVisible();
    await expect(page.getByText('secret.txt')).toHaveCount(0);
    await writeFile(join(project, 'src', 'external.ts'), 'export {};\n');
    await expect(page.getByText('external.ts', { exact: true })).toBeVisible();
    await first.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: testInfo.outputPath('project-structure.png') });

    await useFolderSelection(first, second);
    await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Second Project' })).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toHaveAttribute('aria-selected', 'false');
    await tab.click();
    await rename(project, moved);
    await page.getByRole('button', { name: 'Rescan' }).click();
    await expect(page.getByText('Folder not found', { exact: true })).toBeVisible();
    await useFolderSelection(first, moved);
    await page.getByRole('button', { name: 'Locate Folder' }).click();
    await expect(page.getByRole('heading', { name: 'Project Overview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Managed café', exact: true })).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(3);
    expect(await page.evaluate((stale) => window.studio!.projects.rescan(stale), id))
      .toEqual({ ok: false, error: 'ACCESS_DENIED' });

    await first.close();
    instance = undefined;
    const relaunched = await launch();
    const mainPage = await relaunched.firstWindow();
    await mainPage.getByRole('navigation').getByRole('button', { name: 'Recent Projects', exact: true }).click();
    await expect(mainPage.getByRole('heading', { name: 'Recent Projects' })).toBeVisible();
    await mainPage.getByRole('button', { name: 'Open Managed café' }).click();
    await expect(mainPage.getByRole('heading', { name: 'Managed café', exact: true })).toBeVisible();
    await expect(mainPage.getByRole('group', { name: 'Project context' })).toContainText('Moved project');
  } finally {
    await instance?.close();
    await rm(fixture, { recursive: true, force: true, maxRetries: 3 });
  }
});
