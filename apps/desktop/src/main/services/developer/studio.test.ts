import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { isHandoff, isPlaygroundRequest, STARTER, success } from '@factory/contracts';
import type { GitState } from '@factory/contracts';
import { planProject } from '@factory/generator';
import { admitRoot } from '../projects/filesystem';
import { GitStudio } from '../git/studio';
import { findGit } from '../git/process';
import { DeveloperStudio } from './studio';

describe('developer workspace native operations', () => {
  it('requires review, rejects stale and cross-worktree actions, and sends bounded HTTP to a real managed backend', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'factory-developer-')));
    const first = join(root, 'Inventory α');
    const second = join(root, 'Parallel β');
    const id = randomUUID();
    const other = randomUUID();
    const third = randomUUID();
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not bind.');
    const port = address.port;
    const manifest = planProject({ name: 'Inventory Alpha', slug: 'inventory-alpha', port, modules: [],
      appType: STARTER.appType, stack: STARTER.stack, architecture: STARTER.architecture,
      engineering: STARTER.engineering, database: STARTER.database }, randomUUID());
    await Promise.all([mkdir(first), mkdir(second)]);
    for (const { path, content } of manifest.files) {
      const target = join(first, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    const grants = new Map<string, Awaited<ReturnType<typeof admitRoot>>>([[id, await admitRoot(first)], [other, await admitRoot(second)]]);
    let gitState: GitState = { state: 'not-repository', detail: 'Fixture workspace.' };
    const confirm = vi.fn(async () => true);
    const reveal = vi.fn();
    const copy = vi.fn<(text: string) => void>();
    const service = new DeveloperStudio({
      root: (key) => grants.get(key), allows: (path) => !path.startsWith(root), git: async () => success(gitState),
    }, { confirm, reveal, copy, openURL: async () => undefined, chooseEditor: async () => null });
    try {
      const selection = { projectId: id, task: 'backend' as const, frontendPort: 5173 };
      const command = await service.preview(selection);
      expect(command.ok).toBe(true);
      if (!command.ok) return;
      expect(command.value.cwd).toBe(first);
      expect(command.value.steps[0]?.args).toContain('server/server.ts');
      expect(await service.start({ projectId: id, id: command.value.id })).toEqual({ ok: false, error: 'DEVELOPER_PORT' });
      expect(confirm).not.toHaveBeenCalled();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
      const beforeEdit = await service.preview(selection);
      if (!beforeEdit.ok) throw new Error('Could not review fixture.');
      expect(await service.start({ projectId: other, id: beforeEdit.value.id })).toEqual({ ok: false, error: 'DEVELOPER_STALE' });

      const serverPath = join(first, 'server', 'server.ts');
      await writeFile(serverPath, `
import { createServer } from 'node:http';
const port = Number(process.env.PORT);
createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.url?.startsWith('/api/redirect')) { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end('moved'); return; }
  if (req.url?.startsWith('/api/oversized')) { res.end('x'.repeat(170000)); return; }
  res.end(JSON.stringify({ received: req.url }));
}).listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'listening', port }));
  console.error('password=fixture-password');
});
`);
      expect(await service.start({ projectId: id, id: beforeEdit.value.id })).toEqual({ ok: false, error: 'DEVELOPER_STALE' });
      expect(confirm).not.toHaveBeenCalled();
      const environment = await service.environment({ projectId: id, port });
      expect(environment).toEqual({ ok: true, value: true });
      expect(await readFile(join(first, '.env'), 'utf8')).toBe('PORT=' + port + '\n');
      expect(await service.environment({ projectId: id, port: port === 65535 ? port - 1 : port + 1 }))
        .toEqual({ ok: false, error: 'DEVELOPER_ENVIRONMENT' });
      const reviewed = await service.preview(selection);
      if (!reviewed.ok) throw new Error('No preview for the disposable backend.');
      gitState = { state: 'unsupported', detail: 'Fixture state changed.' };
      // A snapshot that can no longer run cannot reuse the existing approval.
      expect(await service.start({ projectId: id, id: reviewed.value.id })).toMatchObject({ ok: false });
      gitState = { state: 'not-repository', detail: 'Fixture workspace.' };
      const fresh = await service.preview(selection);
      if (!fresh.ok) throw new Error('No fresh preview.');
      confirm.mockResolvedValueOnce(false);
      expect(await service.start({ projectId: id, id: fresh.value.id })).toEqual({ ok: false, error: 'ACCESS_DENIED' });
      const approved = await service.preview(selection);
      if (!approved.ok) throw new Error('No command for approval.');
      expect((await service.start({ projectId: id, id: approved.value.id })).ok).toBe(true);
      await expect.poll(async () => {
        const state = await service.logs(id);
        return state.ok ? state.value[0]?.process.ready : false;
      }, { timeout: 8000 }).toBe(true);
      expect(await service.logs(other)).toEqual({ ok: true, value: [] });
      const request = { projectId: id, backendId: approved.value.id, path: '/api/items', method: 'GET' as const,
        query: [['name', 'α'] as [string, string]], headers: [], body: '' };
      expect(await service.request(request)).toMatchObject({ ok: true, value: { status: 200, body: '{"received":"/api/items?name=%CE%B1"}' } });
      expect(await service.request({ ...request, path: '/api/redirect' })).toMatchObject({ ok: true, value: { status: 302 } });
      expect(await service.request({ ...request, path: '/api/oversized' })).toEqual({ ok: false, error: 'DEVELOPER_NETWORK' });
      expect(await service.request({ ...request, projectId: other })).toEqual({ ok: false, error: 'ACCESS_DENIED' });
      expect(await service.request({ ...request, headers: [['Host', '169.254.169.254']] })).toEqual({ ok: false, error: 'INVALID_REQUEST' });
      expect(isPlaygroundRequest({ ...request, path: 'http://169.254.169.254/api' })).toBe(false);
      expect(await service.copy({ projectId: id, id: approved.value.id, stream: 'stderr', search: '' })).toEqual({ ok: true, value: true });
      expect(copy.mock.calls[0]?.[0]).not.toContain('fixture-password');
      expect(await service.control({ projectId: other, id: approved.value.id, action: 'stop' })).toEqual({ ok: false, error: 'ACCESS_DENIED' });

      const dir = join(second, 'external');
      await symlink(first, dir, process.platform === 'win32' ? 'junction' : 'dir');
      const input = { projectId: other, action: 'reveal' as const, path: 'external/server/server.ts', line: null, column: null };
      expect(isHandoff({ ...input, path: '../Inventory α/server/server.ts' })).toBe(false);
      expect((await service.handoff(input)).ok).toBe(false);
      expect(await service.handoff({ ...input, projectId: third })).toEqual({ ok: false, error: 'ACCESS_DENIED' });
      expect(await service.handoff({ ...input, projectId: id, path: 'server/server.ts' })).toEqual({ ok: true, value: true });
      expect(reveal).toHaveBeenCalledWith(serverPath);

      expect(await service.control({ projectId: id, id: approved.value.id, action: 'stop' })).toEqual({ ok: true, value: true });
      expect(await service.logs(id)).toMatchObject({ ok: true, value: [{ process: { state: 'stopped' } }] });
      grants.delete(id);
      await service.reconcile();
      expect(await service.logs(id)).toEqual({ ok: false, error: 'ACCESS_DENIED' });
    } finally {
      if (occupied.listening) await new Promise<void>((resolve) => occupied.close(() => resolve()));
      await service.dispose();
      await rm(root, { recursive: true, force: true, maxRetries: 5 });
    }
  }, 40_000);

  it('uses distinct native Git worktree grants and approved editor coordinates', async () => {
    const executable = await findGit();
    if (!executable) throw new Error('Install native Git in a supported system directory.');
    const fixture = await realpath(await mkdtemp(join(tmpdir(), 'factory-editor-')));
    const primary = join(fixture, 'Project a');
    const linked = join(fixture, 'Feature café');
    const resultPath = join(fixture, 'code.results');
    const id = randomUUID();
    const other = randomUUID();
    const run = (...args: string[]) => promisify(execFile)(executable, args, { cwd: primary, windowsHide: true });
    const grants = new Map<string, Awaited<ReturnType<typeof admitRoot>>>();
    const git = new GitStudio({
      root: (key) => grants.get(key), canOpen: () => true, allowsAuxiliaryPath: () => true,
      adopt: async () => ({ ok: false, error: 'ACCESS_DENIED' }), refresh: async () => undefined,
    }, { chooseDirectory: async () => null, confirm: async () => false }, fixture);
    const editor = join(fixture, 'code');
    const revealed = vi.fn<(path: string) => void>();
    const developer = new DeveloperStudio({
      root: (key) => grants.get(key), allows: () => true, git: (key) => git.status(key),
    }, {
      async confirm(_title, detail) { return detail.includes(fixture); },
      async chooseEditor() { return editor; },
      reveal: revealed, copy: () => undefined, openURL: async () => undefined,
    });
    try {
      await mkdir(primary);
      await run('init', '-b', 'main');
      await writeFile(join(primary, 'source file.ts'), 'export const workspace = true;\n');
      await run('add', '--', 'source file.ts');
      await run('-c', 'user.name=Studio fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=' + fixture, 'commit', '-m', 'Fixture');
      await run('worktree', 'add', '-b', 'parallel', linked);
      grants.set(id, await admitRoot(primary));
      grants.set(other, await admitRoot(linked));
      const one = await git.status(id);
      const two = await git.status(other);
      expect(one).toMatchObject({ ok: true, value: { root: primary, branch: 'main' } });
      expect(two).toMatchObject({ ok: true, value: { root: linked, branch: 'parallel' } });
      if (!one.ok || !two.ok || one.value.state !== 'repository' || two.value.state !== 'repository') throw new Error('Missing test worktree.');
      expect(one.value.repositoryId).toBe(two.value.repositoryId);
      expect(one.value.worktreeId).not.toBe(two.value.worktreeId);

      const file = { projectId: other, path: 'source file.ts', line: null, column: null };
      expect(await developer.handoff({ ...file, action: 'reveal' })).toEqual({ ok: true, value: true });
      expect(revealed).toHaveBeenCalledOnce();
      expect(revealed).toHaveBeenCalledWith(join(linked, 'source file.ts'));
      if (process.platform !== 'win32') {
        await writeFile(editor, '#!/bin/sh\nprintf "%s\\n" "$PWD" "$@" > "$0.results"\n', { mode: 0o700 });
        expect(await developer.handoff({ ...file, action: 'choose-editor', path: null })).toEqual({ ok: true, value: true });
        expect(await developer.handoff({ ...file, action: 'editor', line: 9, column: 3 })).toEqual({ ok: true, value: true });
        await expect.poll(async () => readFile(resultPath, 'utf8').catch(() => ''), { timeout: 5000 })
          .toBe([linked, '--new-window', '--goto', join(linked, 'source file.ts') + ':9:3', ''].join('\n'));
      }
      grants.delete(other);
      expect(await developer.handoff({ ...file, action: 'reveal' })).toEqual({ ok: false, error: 'ACCESS_DENIED' });
    } finally {
      await developer.dispose();
      await git.dispose();
      await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
    }
  }, 30_000);
});
