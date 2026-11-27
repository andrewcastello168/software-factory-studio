import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { availableParallelism, release, tmpdir, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const desktop = fileURLToPath(new URL('../apps/desktop/', import.meta.url));
const require = createRequire(join(desktop, 'package.json'));
const { _electron, expect } = require('@playwright/test');
const packaged = process.env.FACTORY_AUDIT_EXECUTABLE;
const fixture = await realpath(await mkdtemp(join(tmpdir(), 'studio-audit-performance-')));
const repository = join(fixture, 'Audit sample');
const projects = join(fixture, 'generated');
const samples = {};

async function time(name, operation) {
  const start = performance.now();
  const value = await operation();
  (samples[name] ??= []).push(Math.round(performance.now() - start));
  return value;
}

function valid(result) {
  assert(result?.ok, result?.error);
  return result.value;
}

try {
  await mkdir(projects);
  for (let group = 0; group < 12; group++) {
    const directory = join(repository, 'folder-' + group);
    await mkdir(directory, { recursive: true });
    await Promise.all(Array.from({ length: 24 }, (_, index) =>
      writeFile(join(directory, 'file-' + index + '.txt'), 'Fixture source for the audit.\n')));
  }
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: repository });
  for (let run = 0; run < 3; run++) {
    const profile = join(fixture, 'profile-' + run);
    await mkdir(profile);
    let app;
    try {
      const page = await time('startup', async () => {
        app = await _electron.launch({
          executablePath: packaged || require('electron'),
          args: [...(packaged ? [] : [desktop]), '--user-data-dir=' + profile],
          cwd: packaged ? dirname(packaged) : desktop,
          env: { ...process.env, FACTORY_DESKTOP_DEV: '0' }, chromiumSandbox: true,
        });
        const page = await app.firstWindow();
        await expect(page.getByRole('heading', { name: 'Home', exact: true })).toBeVisible();
        return page;
      });
      assert.equal(await app.evaluate(({ app }) => app.isPackaged), Boolean(packaged));
      await app.evaluate(({ dialog }, roots) => {
        let next = 0;
        Object.assign(dialog, {
          showOpenDialog: async () => ({ canceled: false, filePaths: [roots[next++]] }),
          showMessageBox: async () => ({ response: 1 }),
        });
      }, [repository, projects]);
      await time('open288Files', async () => {
        await page.getByRole('button', { name: 'Open Folder', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Project Overview', exact: true })).toBeVisible();
      });
      const source = valid(await page.evaluate(() => globalThis.window.studio.projects.list())).projects[0].id;
      await time('rescan288Files', async () => valid(await page.evaluate((id) => globalThis.window.studio.projects.rescan(id), source)));
      const git = await time('gitStatus288Files', async () => valid(await page.evaluate((id) => globalThis.window.studio.git.status(id), source)));
      assert.equal(git.state, 'repository');

      await page.getByRole('button', { name: 'Home', exact: true }).click();
      await page.getByRole('button', { name: 'New Project', exact: true }).click();
      const wizard = page.getByRole('dialog', { name: 'New Project' });
      await wizard.getByRole('textbox', { name: 'Project name', exact: true }).fill('Audit foundation ' + run);
      await wizard.getByRole('button', { name: 'Choose Folder', exact: true }).click();
      await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
      await time('foundationPreview', async () => {
        await wizard.getByRole('button', { name: 'Review Files', exact: true }).click();
        await expect(wizard.getByRole('heading', { name: 'Review generation plan' })).toBeVisible();
      });
      await wizard.getByRole('button', { name: 'Generate Project', exact: true }).click();
      await wizard.getByRole('button', { name: 'Open Project', exact: true }).click({ timeout: 15_000 });
      const appProject = valid(await page.evaluate(() => globalThis.window.studio.projects.list())).projects.find(({ id }) => id !== source);
      assert(appProject);
      await time('workspaceSwitch', async () => {
        await page.getByRole('tab', { name: /^Audit sample/u }).click();
        await expect(page.getByRole('tab', { name: /^Audit sample/u })).toHaveAttribute('aria-selected', 'true');
      });
      await time('schemaInspection', async () => valid(await page.evaluate((id) => globalThis.window.studio.schema.inspect(id), appProject.id)));

      const listener = createServer().listen(0, '127.0.0.1');
      const port = await new Promise((resolve) => listener.once('listening', () => resolve(listener.address().port)));
      await new Promise((resolve) => listener.close(resolve));
      await writeFile(join(appProject.directory, '.env'), 'PORT=' + port + '\n', { flag: 'wx' });
      await writeFile(join(appProject.directory, 'server/server.ts'),
        "import { createServer } from 'node:http';\n" +
        "createServer((_request, response) => response.end('ready')).listen(Number(process.env.PORT), '127.0.0.1', () => {\n" +
        "for (let row = 0; row < 240; row++) console.log('Verification log ' + row);\n" +
        "console.log(JSON.stringify({ event: 'listening', port: Number(process.env.PORT) }));\n});\n");
      const plan = valid(await page.evaluate((projectId) =>
        globalThis.window.studio.developer.preview({ projectId, task: 'backend', frontendPort: 5173 }), appProject.id));
      valid(await page.evaluate((scope) => globalThis.window.studio.developer.start(scope), { projectId: appProject.id, id: plan.id }));
      await expect.poll(async () => valid(await page.evaluate((id) => globalThis.window.studio.developer.logs(id), appProject.id))[0]?.process.ready).toBe(true);
      const logs = await time('ipc200RuntimeLogs', async () =>
        valid(await page.evaluate((id) => globalThis.window.studio.developer.logs(id), appProject.id)));
      assert.equal(logs[0].lines.length, 200);
      (samples.residentMiB ??= []).push(await app.evaluate(({ app }) =>
        Math.round(app.getAppMetrics().reduce((total, entry) => total + entry.memory.workingSetSize, 0) / 1024)));
      await time('exitWithManagedBackend', () => app.close());
      app = undefined;
      await assert.rejects(globalThis.fetch('http://127.0.0.1:' + port + '/', { signal: globalThis.AbortSignal.timeout(2000) }));
    } finally {
      await app?.close();
    }
  }
  console.log(JSON.stringify({ platform: process.platform, arch: process.arch, kernel: release(),
    logicalCpus: availableParallelism(), memoryMiB: Math.round(totalmem() / 1024 ** 2), hostNode: process.version, packaged: Boolean(packaged), samples }, null, 2));
} finally {
  await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
}
