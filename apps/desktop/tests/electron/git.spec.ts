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
    await instance.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(700, 520); });
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBeLessThan(750);
    await page.getByRole('textbox', { name: 'Commit message' }).fill('Update project mode');
    await page.getByRole('button', { name: 'Commit', exact: true }).click();
    await expect(page.getByText('Staged changes committed.')).toBeVisible();
    expect(git(clone, 'log', '-1', '--format=%s')).toBe('Update project mode');
    await instance.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setSize(1280, 800); });

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
    const switchReview = page.getByRole('dialog', { name: 'Switch the active worktree?' });
    await expect(switchReview).toContainText('refs/heads/topic');
    await switchReview.getByRole('button', { name: 'Confirm Reviewed Operation', exact: true }).click();
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


test('opens a linked worktree separately and reviews a native Git merge', async () => {
  test.setTimeout(90_000);
  const executable = await findGit();
  if (!executable) throw new Error('Git is required for the native worktree test.');
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'factory-native-advanced-')));
  const data = join(fixture, 'Profile');
  const project = join(fixture, 'Project café');
  const linked = join(fixture, 'Feature café');
  let app: ElectronApplication | undefined;
  function git(cwd: string, ...args: string[]) {
    return execFileSync(executable!, ['-c', 'user.name=Test User', '-c', 'user.email=test@example.test', ...args], {
      cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(fixture, 'empty-config') },
    }).trim();
  }
  try {
    await Promise.all([mkdir(project), mkdir(data)]);
    git(project, 'init', '--initial-branch=main', '--template=');
    git(project, 'config', 'user.name', 'Test User');
    git(project, 'config', 'user.email', 'test@example.test');
    await writeFile(join(project, 'app.txt'), 'primary\n');
    git(project, 'add', '--', 'app.txt');
    git(project, 'commit', '-m', 'Initial fixture');
    app = await _electron.launch({ executablePath, args: [resolve('.'), '--user-data-dir=' + data],
      env: { ...process.env, FACTORY_DESKTOP_DEV: '0' }, chromiumSandbox: true });
    await app.evaluate(({ dialog, nativeTheme }, selections) => {
      const queue = [...selections];
      nativeTheme.themeSource = 'light';
      Object.assign(dialog, {
        showOpenDialog: async () => {
          const path = queue.shift();
          if (!path) throw new Error('Unexpected native chooser.');
          return { canceled: false, filePaths: [path] };
        },
        showMessageBox: async (_owner: unknown, options: { defaultId: number; detail: string }) => {
          if (options.defaultId !== 0 || !options.detail.includes('Plan SHA-256')) throw new Error('Expected reviewed consent.');
          return { response: 1 };
        },
      });
    }, [project, fixture]);
    const page = await app.firstWindow();
    await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
    await page.getByRole('button', { name: 'Git Studio', exact: true }).click();
    const advanced = page.getByRole('region', { name: 'Advanced Git actions' });
    await advanced.getByRole('button', { name: 'Worktrees', exact: true }).click();
    await advanced.getByLabel('Folder name', { exact: true }).fill('Feature café');
    await advanced.getByLabel('New branch (optional)', { exact: true }).fill('feature');
    await advanced.getByRole('button', { name: 'Choose Parent and Review' }).click();
    await page.getByRole('dialog', { name: 'Create worktree in a new folder?' }).getByRole('button', { name: 'Confirm Reviewed Operation' }).click();
    await expect(page.getByRole('tab', { name: 'Feature café', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await page.getByRole('tab', { name: 'Project café', exact: true }).click();
    await page.getByRole('button', { name: 'Git Studio', exact: true }).click();
    await advanced.getByRole('button', { name: 'Worktrees', exact: true }).click();
    await expect(advanced.getByRole('list', { name: 'Registered worktrees' })).toContainText('Feature café');
    await page.screenshot({ path: test.info().outputPath('git-studio-worktrees.png') });

    await writeFile(join(linked, 'feature.txt'), 'isolated feature\n');
    await expect(readFile(join(project, 'feature.txt'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    git(linked, 'add', '--', 'feature.txt');
    git(linked, 'commit', '-m', 'Add isolated feature');
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await advanced.getByRole('button', { name: 'Integrate', exact: true }).click();
    await advanced.getByRole('combobox', { name: 'Source branch', exact: true }).selectOption('refs/heads/feature');
    await advanced.getByRole('button', { name: 'Review Integration' }).click();
    const preview = page.getByRole('dialog', { name: 'Review merge?' });
    await expect(preview).toContainText('Fast-forward only');
    await expect(preview).toContainText('isolated feature');
    await app.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'dark'; });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.screenshot({ path: test.info().outputPath('git-studio-integration-review.png') });
    await preview.getByRole('button', { name: 'Confirm Reviewed Operation' }).click();
    await expect(advanced.getByText('Reviewed Git operation completed.', { exact: true })).toBeVisible();
    expect(await readFile(join(project, 'feature.txt'), 'utf8')).toBe('isolated feature\n');
    expect(git(linked, 'branch', '--show-current')).toBe('feature');
  } finally {
    await app?.close();
    await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
  }
});
