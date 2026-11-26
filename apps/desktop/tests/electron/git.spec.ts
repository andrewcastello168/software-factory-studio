import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron, expect, test } from '@playwright/test';
import type { ElectronApplication } from '@playwright/test';
import { findGit } from '../../src/main/services/git/process';

const require = createRequire(import.meta.url);
const executablePath = require('electron') as string;

test('Git Studio clones, commits and switches real native workspaces with read-only comparison', async () => {
  test.setTimeout(60_000);
  const gitPath = await findGit();
  if (!gitPath) throw new Error('Git is required for the native workspace test.');
  const profile = await realpath(await mkdtemp(join(tmpdir(), 'factory-native-git-')));
  const seed = join(profile, 'Seed café');
  const bare = join(profile, 'Bare café.git');
  const target = join(profile, 'Projects');
  const clone = join(target, 'Studio clone');
  const unrelated = join(profile, 'Unrelated folder');
  const appData = join(profile, 'User Data');
  let instance: ElectronApplication | undefined;
  function git(cwd: string, ...args: string[]) {
    return execFileSync(gitPath!, ['-c', 'user.name=Test User', '-c', 'user.email=test@example.test', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(profile, 'empty-config') },
    }).trim();
  }
  try {
    await Promise.all([seed, bare, target, unrelated, appData].map((p) => mkdir(p)));
    git(seed, 'init', '--initial-branch=main', '--template=');
    git(bare, 'init', '--bare', '--initial-branch=main', '--template=');
    await writeFile(join(seed, 'service.txt'), 'export mode=standard\n');
    git(seed, 'add', '--', 'service.txt');
    git(seed, 'commit', '-m', 'Initial project');
    git(seed, 'switch', '-c', 'topic');
    await writeFile(join(seed, 'topic.txt'), 'from topic only\n');
    git(seed, 'add', '--', 'topic.txt');
    git(seed, 'commit', '-m', 'Add topic file');
    git(seed, 'push', bare, 'main', 'topic');

    instance = await _electron.launch({
      executablePath,
      args: [resolve('.'), `--user-data-dir=${appData}`],
      env: { ...process.env, FACTORY_DESKTOP_DEV: '0' },
      chromiumSandbox: true,
    });
    await instance.evaluate(({ dialog, nativeTheme }, paths) => {
      nativeTheme.themeSource = 'light';
      const queue = [...paths];
      Object.assign(dialog, {
        showOpenDialog: async (_owner: unknown, options: { properties: string[] }) => {
          if (!options.properties.includes('openDirectory') || !queue.length) throw new Error('Expected a planned native chooser.');
          return { canceled: false, filePaths: [queue.shift()] };
        },
        showMessageBox: async (_owner: unknown, options: { defaultId: number; buttons: string[]; detail: string }) => {
          if (options.defaultId !== 0 || options.buttons[0] !== 'Cancel' || !options.detail) throw new Error('Expected a safe confirmation.');
          return { response: 1 };
        },
      });
    }, [bare, target, unrelated]);
    const page = await instance.firstWindow();
    page.setDefaultTimeout(8000);
    await expect(page).toHaveURL('studio://app/');
    await page.getByRole('button', { name: 'Clone Repository', exact: true }).click();
    await page.getByRole('combobox', { name: 'Source', exact: true }).selectOption('local');
    await page.getByLabel('New folder name', { exact: true }).fill('Studio clone');
    await page.getByRole('button', { name: 'Choose Folders' }).click();
    await expect(page.getByRole('heading', { name: 'Git Studio' })).toBeVisible();
    await expect(page.getByText('origin/main', { exact: true }).first()).toBeVisible();
    const studio = page.getByRole('tab', { name: 'Studio clone' });
    const id = (await studio.getAttribute('id'))?.replace('workspace-tab-', '');
    if (!id) throw new Error('Missing project tab identifier.');
    expect(await page.evaluate((token) => Reflect.apply(window.studio!.git.action, null, [
      { id: token, operation: 'init', revision: null, cwd: '../Unrelated folder' },
    ]), id)).toEqual({ ok: false, error: 'INVALID_REQUEST' });
    expect(await readFile(join(clone, 'service.txt'), 'utf8')).toBe('export mode=standard\n');
    git(clone, 'config', 'user.name', 'Test User');
    git(clone, 'config', 'user.email', 'test@example.test');
    git(clone, 'branch', '--no-track', 'topic', 'refs/remotes/origin/topic');
    await writeFile(join(clone, 'service.txt'), 'export mode=reviewed\n');
    const file = page.getByRole('button', { name: /service.txt/ }).filter({ hasText: 'service.txt' });
    await expect(file).toBeVisible({ timeout: 12_000 });
    await file.click();
    await expect(page.getByLabel('Git patch')).toContainText('+export mode=reviewed');
    await page.screenshot({ path: test.info().outputPath('git-studio-light.png') });
    await page.getByRole('button', { name: 'Stage service.txt', exact: true }).click();
    await expect(page.getByText('Selected change staged.', { exact: true })).toBeVisible();
    const staged = page.getByRole('region', { name: 'Staged changes' });
    await expect(staged).toContainText('service.txt');
    await page.getByRole('textbox', { name: 'Commit message' }).fill('Update project mode');
    await page.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(page.getByText('Staged changes committed.')).toBeVisible();
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('Update project mode');

    await page.getByRole('button', { name: 'Create branch', exact: true }).click();
    await page.getByLabel('Branch name', { exact: true }).fill('review');
    await page.getByRole('button', { name: 'Review Branch', exact: true }).click();
    await expect(page.getByText('Local branch created.', { exact: false })).toBeVisible();
    const chooser = page.getByRole('combobox', { name: 'Branch', exact: true });
    await chooser.selectOption('refs/remotes/origin/topic');
    await page.getByRole('button', { name: 'Compare', exact: true }).click();
    await expect(page.getByLabel('Git patch')).toContainText('from topic only');
    await expect(page.getByRole('button', { name: 'Switch', exact: true })).toBeDisabled();
    await instance.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: test.info().outputPath('git-studio-dark.png') });
    await chooser.selectOption('refs/heads/topic');
    await page.getByRole('button', { name: 'Switch', exact: true }).click();
    await expect(page.getByText('Branch switched and project refreshed.')).toBeVisible();
    expect(git(clone, 'branch', '--show-current')).toBe('topic');
    expect(git(clone, 'show', 'review:service.txt')).toBe('export mode=reviewed');
    await page.getByRole('button', { name: 'Project Structure', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Project Structure' })).toBeVisible();
    await expect(page.getByText('topic.txt', { exact: true })).toBeVisible();

    await page.getByRole('tab', { name: 'Workspace', exact: true }).click();
    await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Unrelated folder' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('group', { name: 'Project context' })).toContainText('No repository');
    await studio.click();
    await expect(page.getByRole('group', { name: 'Project context' })).toContainText('topic');
    await studio.press('Delete');
    await expect(studio).toBeHidden();
    expect(await page.evaluate((closedId) => window.studio!.git.status(closedId), id))
      .toEqual({ ok: false, error: 'ACCESS_DENIED' });
  } finally {
    await instance?.close();
    await rm(profile, { recursive: true, force: true, maxRetries: 4 });
  }
});

test('Git Studio clones an anonymous public HTTPS repository with verified TLS', async () => {
  test.skip(process.env.FACTORY_TEST_PUBLIC_HTTPS !== '1', 'Requires direct outbound HTTPS to GitHub.');
  test.setTimeout(45_000);
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'factory-native-https-')));
  const profile = join(fixture, 'profile');
  const destination = join(fixture, 'projects');
  let instance: ElectronApplication | undefined;
  try {
    await Promise.all([mkdir(profile), mkdir(destination)]);
    instance = await _electron.launch({
      executablePath,
      args: [resolve('.'), `--user-data-dir=${profile}`],
      env: { ...process.env, FACTORY_DESKTOP_DEV: '0' },
      chromiumSandbox: true,
    });
    await instance.evaluate(({ dialog }, path) => {
      Object.assign(dialog, {
        showOpenDialog: async () => ({ canceled: false, filePaths: [path] }),
        showMessageBox: async () => ({ response: 1 }),
      });
    }, destination);
    const page = await instance.firstWindow();
    const result = await page.evaluate(() => window.studio!.git.clone({
      source: 'https', url: 'https://github.com/octocat/Hello-World.git', name: 'Public HTTPS fixture',
    }));
    expect(result).toMatchObject({ ok: true, value: { level: 'success', selection: { projectId: expect.any(String) } } });
    const file = await readFile(join(destination, 'Public HTTPS fixture', 'README'), 'utf8');
    expect(file).toMatch(/hello world/iu);
  } finally {
    await instance?.close();
    await rm(fixture, { recursive: true, force: true, maxRetries: 4 });
  }
});
