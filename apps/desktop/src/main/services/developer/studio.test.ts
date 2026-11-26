import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { isHandoff, isPlaygroundRequest, STARTER, success } from '@factory/contracts';
import type { GitState } from '@factory/contracts';
import { planProject } from '@factory/generator';
import { admitRoot } from '../projects/filesystem';
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
});
