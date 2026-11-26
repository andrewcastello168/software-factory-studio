import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isProjectCatalog, PROJECT_LIMITS } from '@factory/contracts';
import type { ProjectCatalog, ProjectSelection, Result } from '@factory/contracts';
import { admitRoot } from './filesystem';
import { RecentStore } from './recents';
import { readProjectMetadata, scanProject } from './scan';
import { ProjectWorkspace } from './workspace';

const descriptorId = '02b192a8-b874-4423-9add-af527064998f';
let temp: string;
let profile: string;
let root: string;
let services: ProjectWorkspace[];

beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), 'factory-project-workspace-'));
  profile = join(temp, 'profile');
  root = join(temp, 'Proyek café');
  await mkdir(root);
  services = [];
});

afterEach(async () => {
  for (const service of services) service.dispose();
  await rm(temp, { recursive: true, force: true, maxRetries: 3 });
});

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function workspace(paths: (string | null)[], confirm = vi.fn(async () => false)) {
  const events: ProjectCatalog[] = [];
  const choose = vi.fn(async () => paths.shift() ?? null);
  const service = new ProjectWorkspace(
    new RecentStore(join(profile, 'recent-projects.json')), { choose, confirmReplacement: confirm },
    (catalog) => events.push(catalog),
  );
  services.push(service);
  return { service, choose, confirm, events };
}

async function managed(directory: string, descriptor: object = {}) {
  await mkdir(join(directory, '.factory'));
  await writeFile(join(directory, '.factory', 'project.json'), JSON.stringify({
    version: 1, id: descriptorId, ...descriptor,
  }));
}

describe('local project folder admission', () => {
  it('opens real projects read-only and restores persistent recent references', async () => {
    await managed(root, { name: 'Managed café', stackId: 'example' });
    const filename = join(root, 'package.json');
    const body = Buffer.from('{"scripts":{"install":"never-run-this"}}\n');
    await writeFile(filename, body);
    const before = await readdir(root);
    const metadata = await readFile(join(root, '.factory', 'project.json'));
    const { service } = workspace([root]);
    const opened = value(await service.openFolder());
    expect(opened.catalog.projects[0]).toMatchObject({
      name: 'Managed café', availability: 'ready',
      metadata: { status: 'managed', descriptor: { id: descriptorId, stackId: 'example' } },
    });
    expect(isProjectCatalog(opened.catalog)).toBe(true);
    expect(await readdir(root)).toEqual(before);
    expect(await readFile(filename)).toEqual(body);
    expect(await readFile(join(root, '.factory', 'project.json'))).toEqual(metadata);
    const recentId = opened.catalog.recents[0]!.id;
    service.dispose();

    const next = workspace([]).service;
    expect(value(await next.list()).projects).toEqual([]);
    const restored = value(await next.openRecent(recentId));
    expect(restored.catalog.projects[0]?.directory).toBe(opened.catalog.projects[0]?.directory);
    expect(restored.catalog.recents[0]?.id).toBe(recentId);
    expect(value(await next.removeRecent(recentId)).recents).toEqual([]);
    expect(await readFile(filename)).toEqual(body);
  });

  it('deduplicates canonical paths but keeps distinct worktrees with the same portable ID', async () => {
    const second = join(temp, 'secondary');
    await mkdir(second);
    await managed(root);
    await managed(second);
    const { service } = workspace([root, join(root, '.'), second]);
    const original = value(await service.openFolder());
    const duplicate = value(await service.openFolder());
    expect(duplicate.projectId).toBe(original.projectId);
    const another = value(await service.openFolder());
    expect(another.projectId).not.toBe(original.projectId);
    expect(another.catalog.projects).toHaveLength(2);
    expect(new Set(another.catalog.projects.map((entry) => entry.recentId)).size).toBe(2);
    expect(value(await service.close(original.projectId!)).projects).toHaveLength(1);
    expect(await service.rescan(original.projectId!)).toEqual({ ok: false, error: 'ACCESS_DENIED' });
  });

  it('detects external edits, rescans, and invalidates a moved root', async () => {
    const { service, events } = workspace([root]);
    const opened = value(await service.openFolder());
    const id = opened.projectId!;
    await writeFile(join(root, 'external.txt'), 'a');
    await vi.waitFor(() => expect(events.at(-1)?.projects[0]?.entries).toEqual([
      expect.objectContaining({ path: 'external.txt', kind: 'file', size: 1 }),
    ]), { timeout: 5_000 });
    await writeFile(join(root, 'external.txt'), 'rescan contents');
    expect(value(await service.rescan(id)).projects[0]?.entries[0]?.size).toBe(15);
    await rename(root, join(temp, 'moved'));
    const catalog = value(await service.rescan(id));
    expect(catalog.projects[0]?.availability).toBe('missing');
    expect(catalog.projects[0]?.entries).toEqual([]);
    expect(catalog.recents[0]?.availability).toBe('missing');
  }, 10_000);

  it('locates a moved managed project and requires confirmation for a different identity', async () => {
    const moved = join(temp, 'relocated');
    const replacement = join(temp, 'another');
    await mkdir(replacement);
    await managed(root);
    const { service, confirm } = workspace([root, moved, replacement, replacement]);
    const opened: ProjectSelection = value(await service.openFolder());
    const oldRecent = opened.catalog.recents[0]!;
    await rename(root, moved);
    await service.rescan(opened.projectId!);
    const located = value(await service.locateRecent(oldRecent.id));
    expect(located.projectId).not.toBe(opened.projectId);
    expect(await service.rescan(opened.projectId!)).toEqual({ ok: false, error: 'ACCESS_DENIED' });
    expect(located.catalog.recents[0]?.directory).toBe((await admitRoot(moved)).path);
    expect(confirm).not.toHaveBeenCalled();
    expect(value(await service.locateRecent(oldRecent.id)).projectId).toBeNull();
    expect(confirm).toHaveBeenCalledOnce();
    confirm.mockResolvedValueOnce(true);
    expect(value(await service.locateRecent(oldRecent.id)).catalog.recents[0]?.directory)
      .toBe((await admitRoot(replacement)).path);
  });

  it('rejects a replaced root until a native chooser authorizes the new directory', async () => {
    const { service } = workspace([root, root]);
    await writeFile(join(root, 'original'), 'prior');
    const opened = value(await service.openFolder());
    await rename(root, join(temp, 'old'));
    await mkdir(root);
    await writeFile(join(root, 'replacement'), 'new');
    expect(await service.openRecent(opened.catalog.recents[0]!.id)).toEqual({ ok: false, error: 'PROJECT_UNAVAILABLE' });
    const changed = value(await service.rescan(opened.projectId!));
    expect(changed.projects[0]).toMatchObject({ availability: 'changed', entries: [] });
    expect(changed.recents[0]?.availability).toBe('changed');
    const reopened = value(await service.openFolder());
    expect(reopened.catalog.projects).toHaveLength(1);
    expect(reopened.projectId).not.toBe(opened.projectId);
    expect(reopened.catalog.projects.find((tab) => tab.id === reopened.projectId)?.entries[0]?.path).toBe('replacement');
  });

  it('keeps opening read-only when project admission includes the app data directory', async () => {
    const { service } = workspace([temp]);
    const before = await readdir(temp);
    expect(value(await service.openFolder()).catalog.recentsStatus).toBe('unsaved');
    expect(await readdir(temp)).toEqual(before);
  });

  it('preserves an unreadable recent store and leaves chooser cancellation inert', async () => {
    await mkdir(profile);
    const store = join(profile, 'recent-projects.json');
    await writeFile(store, '{"version":2}');
    const { service } = workspace([null, root]);
    const cancelled = value(await service.openFolder());
    expect(cancelled.projectId).toBeNull();
    expect(cancelled.catalog.projects).toHaveLength(0);
    expect(value(await service.openFolder()).catalog.recentsStatus).toBe('unreadable');
    expect(await readFile(store, 'utf8')).toBe('{"version":2}');
  });
});

describe('bounded filesystem inspection', () => {
  it('never traverses outside the root through a symlink or Windows junction', async () => {
    const outside = join(temp, 'outside');
    await mkdir(outside);
    await writeFile(join(outside, 'private.txt'), 'outside project');
    await writeFile(join(outside, 'project.json'), JSON.stringify({ version: 1, id: descriptorId }));
    await symlink(outside, join(root, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
    await symlink(outside, join(root, '.factory'), process.platform === 'win32' ? 'junction' : 'dir');
    const result = await scanProject(await admitRoot(root));
    expect(result.entries).toEqual([
      { path: '.factory', kind: 'link', modifiedAt: null, size: null },
      { path: 'outside-link', kind: 'link', modifiedAt: null, size: null },
    ]);
    expect(result.metadata).toEqual({ status: 'blocked' });
    await expect(admitRoot(join(root, 'outside-link'))).rejects.toThrow();
  });

  it('distinguishes absent, unsupported, and invalid metadata without creating files', async () => {
    const identity = await admitRoot(root);
    expect(await readProjectMetadata(identity)).toEqual({ status: 'absent' });
    expect(await readdir(root)).toEqual([]);
    await managed(root, { version: 2 });
    expect(await readProjectMetadata(identity)).toEqual({ status: 'unsupported' });
    await writeFile(join(root, '.factory', 'project.json'), '{"version":1}');
    expect(await readProjectMetadata(identity)).toEqual({ status: 'invalid' });
  });

  it('bounds depth and omits dependency directories without inventing entries', async () => {
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'dependency'), 'omitted');
    let deep = root;
    for (let index = 0; index <= PROJECT_LIMITS.depth; index++) {
      deep = join(deep, 'nested');
      await mkdir(deep);
    }
    const result = await scanProject(await admitRoot(root));
    expect(result.entries).toHaveLength(PROJECT_LIMITS.depth);
    expect(result.entries.every((entry) => entry.kind === 'directory')).toBe(true);
    expect(result.partial).toBe(true);
  });
});
