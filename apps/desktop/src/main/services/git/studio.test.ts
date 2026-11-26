import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { success } from '@factory/contracts';
import type { GitAction, GitActionInput, GitRepository, Result } from '@factory/contracts';
import { admitRoot } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { findGit } from './process';
import { localRemotePath, publicHttps, safeGitPath } from './repository';
import { GitStudio } from './studio';

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const id = '8dc85951-c488-45d5-ae75-dbe67b6e86ab';
const cloned = '61d08f57-154e-45c2-9c2c-9760fa7618b4';
const actor = ['-c', 'user.name=Studio Test', '-c', 'user.email=studio@example.test'];
let executable: string;
let fixture: string;
let work: string;
let service: GitStudio;
let grants: Map<string, ProjectRoot>;
let approve: () => Promise<boolean>;
let choices: string[];

function git(cwd: string, ...arguments_: string[]) {
  return execFileSync(executable, [...actor, ...arguments_], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(fixture, 'git-empty') },
  }).trim();
}

async function status() {
  const result = unwrap(await service.status(id));
  if (result.state !== 'repository') throw new Error(JSON.stringify(result));
  return result;
}

async function act(input: GitActionInput, expected?: GitRepository) {
  const snap = input.operation === 'init' ? null : (expected ?? await status()).revision;
  return unwrap(await service.action({ ...input, id, revision: snap } as GitAction));
}

async function initialize() {
  await writeFile(join(work, 'app.txt'), 'original\n');
  const result = await act({ operation: 'init' });
  expect(result).toMatchObject({ level: 'success', status: { state: 'repository', branch: 'main', head: null } });
  git(work, 'config', 'user.name', 'Studio Test');
  git(work, 'config', 'user.email', 'studio@example.test');
  return status();
}

async function baseline() {
  await initialize();
  git(work, 'add', '--', 'app.txt');
  git(work, 'commit', '-m', 'initial');
  return status();
}

beforeEach(async () => {
  const found = await findGit();
  if (!found) throw new Error('Install Git in a conventional system location for integration tests.');
  executable = found;
  fixture = await realpath(await mkdtemp(join(tmpdir(), 'factory-git-fixture-')));
  work = join(fixture, 'Project café');
  await mkdir(work);
  grants = new Map([[id, await admitRoot(work)]]);
  approve = async () => true;
  choices = [];
  service = new GitStudio({
    root: (key) => grants.get(key),
    canOpen: () => true,
    allowsAuxiliaryPath: () => true,
    adopt: async (root) => {
      grants.set(cloned, root);
      return success({ projectId: cloned, catalog: { projects: [], recents: [], revision: 0, recentsStatus: 'ready' } });
    },
    refresh: async () => undefined,
  }, {
    confirm: () => approve(),
    chooseDirectory: async () => choices.shift() ?? null,
  });
});

afterEach(async () => {
  await service?.dispose();
  if (fixture) await rm(fixture, { recursive: true, force: true, maxRetries: 4 });
});

describe('native Git workspace', () => {
  it('initializes explicitly, inspects an unborn branch, stages, unstages and commits only the selected content', async () => {
    expect(unwrap(await service.status(id)).state).toBe('not-repository');
    approve = async () => false;
    expect((await act({ operation: 'init' })).level).toBe('cancelled');
    expect(existsSync(join(work, '.git'))).toBe(false);
    approve = async () => true;
    const first = await initialize();
    expect(first.changes).toMatchObject([{ path: 'app.txt', worktree: '?' }]);
    const untracked = unwrap(await service.diff({ id, revision: first.revision, row: 0, area: 'working' }));
    expect(untracked.text).toContain('+original');
    expect((await act({ operation: 'stage', row: 0 })).level).toBe('success');
    const staged = await status();
    expect(staged.changes[0]?.index).toBe('A');
    expect(unwrap(await service.diff({ id, revision: staged.revision, row: 0, area: 'staged' })).text).toContain('+original');
    expect((await act({ operation: 'unstage', row: 0 })).level).toBe('success');
    expect((await status()).changes[0]?.worktree).toBe('?');
    expect((await act({ operation: 'stage', row: 0 })).level).toBe('success');
    await writeFile(join(work, 'app.txt'), 'editor still working\n');
    const outcome = await act({ operation: 'commit', message: 'First Studio commit' });
    expect(outcome.level, outcome.message).toBe('success');
    expect(git(work, 'show', 'HEAD:app.txt')).toBe('original');
    expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('editor still working\n');
    expect(await status()).toMatchObject({ changes: [{ index: '.', worktree: 'M' }] });
    expect((await act({ operation: 'stage', row: 0 })).level).toBe('success');
    expect((await act({ operation: 'unstage', row: 0 })).level).toBe('success');
    expect(await status()).toMatchObject({ changes: [{ index: '.', worktree: 'M' }] });
  });

  it('compares immutable refs without checkout, cancels dirty checkout and switches explicitly from detached HEAD', async () => {
    const initial = await baseline();
    expect((await act({ operation: 'create', name: 'topic' })).level).toBe('success');
    git(work, 'switch', 'topic');
    await writeFile(join(work, 'app.txt'), 'topic version\n');
    git(work, 'commit', '-am', 'topic');
    git(work, 'switch', 'main');
    const clean = await status();
    const compare = unwrap(await service.compare({ id, revision: clean.revision, ref: 'refs/heads/topic' }));
    expect(compare.text).toContain('+topic version');
    expect(git(work, 'branch', '--show-current')).toBe('main');
    await writeFile(join(work, 'Untracked café.txt'), 'keep it');
    expect((await act({ operation: 'switch', ref: 'refs/heads/topic' })).message).toContain('Checkout is blocked');
    expect(await readFile(join(work, 'Untracked café.txt'), 'utf8')).toBe('keep it');
    await rm(join(work, 'Untracked café.txt'));
    git(work, 'switch', '--detach', initial.head!);
    expect(await status()).toMatchObject({ branch: null, head: initial.head });
    const switched = await act({ operation: 'switch', ref: 'refs/heads/topic' });
    expect(switched.level, switched.message).toBe('success');
    expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('topic version\n');
  });

  it('rejects drift during confirmation and revokes closed or moved grants', async () => {
    await baseline();
    git(work, 'branch', 'topic');
    approve = async () => {
      await writeFile(join(work, 'app.txt'), 'external edit\n');
      return true;
    };
    const stale = await act({ operation: 'switch', ref: 'refs/heads/topic' });
    expect(stale).toMatchObject({ level: 'error', message: expect.stringContaining('changed since review') });
    expect(git(work, 'branch', '--show-current')).toBe('main');
    expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('external edit\n');
    await rename(work, join(fixture, 'Moved'));
    expect(unwrap(await service.status(id)).state).toBe('missing');
    grants.delete(id);
    expect(await service.status(id)).toEqual({ ok: false, error: 'ACCESS_DENIED' });
  });

  it('keeps ignored data and blocks in-progress Git operations', async () => {
    await baseline();
    await writeFile(join(work, '.gitignore'), 'local.env\n');
    git(work, 'add', '.gitignore');
    git(work, 'commit', '-m', 'ignore');
    git(work, 'switch', '-c', 'topic');
    await writeFile(join(work, 'local.env'), 'example tracked value\n');
    git(work, 'add', '-f', 'local.env');
    git(work, 'commit', '-m', 'branch tracks local env');
    git(work, 'switch', 'main');
    await writeFile(join(work, 'local.env'), 'local settings\n');
    expect((await status()).changes).toHaveLength(0);
    const result = await act({ operation: 'switch', ref: 'refs/heads/topic' });
    expect(result.level).toBe('error');
    expect(await readFile(join(work, 'local.env'), 'utf8')).toBe('local settings\n');
    await writeFile(join(work, '.git', 'CHERRY_PICK_HEAD'), `${git(work, 'rev-parse', 'HEAD')}\n`);
    expect(await status()).toMatchObject({ operation: 'cherry-pick' });
    expect((await act({ operation: 'switch', ref: 'refs/heads/topic' })).message).toContain('in-progress');
  });

  it('ignores executable hooks and blocks unsafe config, metadata junctions and hidden index entries', async () => {
    await baseline();
    await mkdir(join(work, '.git', 'hooks'), { recursive: true });
    const marker = join(work, 'hook-ran');
    await writeFile(join(work, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\ntouch hook-ran\n', { mode: 0o755 });
    await writeFile(join(work, 'app.txt'), 'new\n');
    expect((await act({ operation: 'stage', row: 0 })).level).toBe('success');
    expect((await act({ operation: 'commit', message: 'Hook stays disabled' })).level).toBe('success');
    expect(existsSync(marker)).toBe(false);
    git(work, 'config', 'filter.external.clean', 'unsupported tool');
    expect(unwrap(await service.status(id)).state).toBe('unsupported');
    git(work, 'config', '--unset', 'filter.external.clean');
    git(work, 'config', 'include.path', join(fixture, 'outside-config'));
    expect(unwrap(await service.status(id)).state).toBe('unsupported');
    git(work, 'config', '--unset', 'include.path');
    const outside = join(fixture, 'outside');
    await mkdir(outside);
    const linked = join(work, '.git', 'elsewhere');
    await symlink(outside, linked, process.platform === 'win32' ? 'junction' : 'dir');
    expect(unwrap(await service.status(id)).state).toBe('unsupported');
    await rm(linked);
    git(work, 'update-index', '--assume-unchanged', 'app.txt');
    expect((await act({ operation: 'create', name: 'blocked' })).message).toContain('assume-unchanged');
  });

  it('refreshes re-edited files and shows real rename and conflict records', { timeout: 15_000 }, async () => {
    const initial = await baseline();
    git(work, 'mv', 'app.txt', 'renamed.txt');
    expect((await status()).changes[0]).toMatchObject({ path: 'renamed.txt', original: 'app.txt', index: 'R' });
    git(work, 'commit', '-m', 'Rename');
    await writeFile(join(work, 'renamed.txt'), 'external edit longer\n');
    const dirty = await status();
    await writeFile(join(work, 'renamed.txt'), 'different edit\n');
    expect(await service.diff({ id, revision: dirty.revision, row: 0, area: 'working' }))
      .toEqual({ ok: false, error: 'GIT_STALE' });
    expect((await act({ operation: 'stage', row: 0 }, dirty)).level).toBe('error');
    git(work, 'commit', '-am', 'Edit main');
    git(work, 'switch', '-c', 'topic', initial.head!);
    await writeFile(join(work, 'app.txt'), 'topic content\n');
    git(work, 'commit', '-am', 'Edit topic');
    git(work, 'switch', 'main');
    expect(() => git(work, 'merge', 'topic')).toThrow();
    const conflict = await status();
    expect(conflict.operation).toBe('merge');
    expect(conflict.changes.some((change) => change.index === 'U' || change.worktree === 'U')).toBe(true);
    expect((await act({ operation: 'commit', message: 'Do not finish a conflict' })).level).toBe('error');
    expect(git(work, 'rev-parse', 'MERGE_HEAD')).toBe(git(work, 'rev-parse', 'topic'));
  });

  it('clones into a fresh folder, fetches, fast-forwards, pushes and preserves divergent history', { timeout: 30_000 }, async () => {
    await baseline();
    const remote = join(fixture, 'Bare café.git');
    const other = join(fixture, 'External');
    await mkdir(remote);
    git(remote, 'init', '--bare', '--template=', '--initial-branch=main');
    git(work, 'remote', 'add', 'origin', remote);
    git(work, 'push', '--set-upstream', 'origin', 'main');
    git(work, 'update-ref', '-d', 'refs/remotes/origin/main');
    expect(await status()).toMatchObject({ upstream: 'origin/main', ahead: null, behind: null });
    choices = [remote, fixture];
    const clone = unwrap(await service.clone({ source: 'local', name: 'Studio clone' }));
    expect(clone.level, clone.message).toBe('success');
    expect(await readFile(join(fixture, 'Studio clone', 'app.txt'), 'utf8')).toBe('original\n');
    expect(unwrap(await service.status(cloned))).toMatchObject({ branch: 'main', upstream: 'origin/main', changes: [] });
    choices = [remote, fixture];
    const collision = unwrap(await service.clone({ source: 'local', name: 'Studio clone' }));
    expect(collision.level).toBe('error');
    expect(await readFile(join(fixture, 'Studio clone', 'app.txt'), 'utf8')).toBe('original\n');

    git(fixture, 'clone', '--template=', remote, other);
    await writeFile(join(other, 'external.txt'), 'remote change\n');
    git(other, 'add', 'external.txt');
    git(other, 'commit', '-m', 'remote change');
    git(other, 'push', 'origin', 'main');
    choices = [remote];
    const fetch = await act({ operation: 'fetch', remote: 'origin' });
    expect(fetch.level, fetch.message).toBe('success');
    expect(fetch.status).toMatchObject({ behind: 1, ahead: 0 });
    expect(existsSync(join(work, 'external.txt'))).toBe(false);
    choices = [remote];
    const pull = await act({ operation: 'pull' });
    expect(pull.level, pull.message).toBe('success');
    expect(await readFile(join(work, 'external.txt'), 'utf8')).toBe('remote change\n');

    await writeFile(join(work, 'local.txt'), 'work change\n');
    git(work, 'add', 'local.txt');
    git(work, 'commit', '-m', 'work change');
    choices = [remote];
    const push = await act({ operation: 'push' });
    expect(push.level, push.message).toBe('success');
    expect(git(remote, 'rev-parse', 'main')).toBe(git(work, 'rev-parse', 'main'));
    expect(push.status).toMatchObject({ ahead: 0, behind: 0 });
    git(other, 'pull', '--ff-only', 'origin', 'main');

    await writeFile(join(work, 'local.txt'), 'work diverged\n');
    git(work, 'commit', '-am', 'work diverged');
    await writeFile(join(other, 'external.txt'), 'remote diverged\n');
    git(other, 'commit', '-am', 'remote diverged');
    git(other, 'push', 'origin', 'main');
    const head = git(work, 'rev-parse', 'HEAD');
    choices = [remote];
    const divergence = await act({ operation: 'pull' });
    expect(divergence).toMatchObject({ level: 'error', message: expect.stringContaining('diverged') });
    expect(git(work, 'rev-parse', 'HEAD')).toBe(head);
    choices = [remote];
    const rejected = await act({ operation: 'push' });
    expect(rejected.level).toBe('error');
    expect(git(remote, 'rev-parse', 'main')).toBe(git(other, 'rev-parse', 'main'));
  });
});

it('accepts only reviewed transport formats and canonical Git path syntax', () => {
  expect(publicHttps('https://github.com/owner/project.git')).toBe('https://github.com/owner/project.git');
  for (const value of ['http://example.test/repo', 'https://user:token@host.test/r', 'https://host.test/r?token=x',
    'ext::something', 'https://host.test/%2e%2e/x', 'https://host.test/r#fragment']) expect(publicHttps(value)).toBeNull();
  expect(localRemotePath('file://remote-host/share')).toBeNull();
  expect(localRemotePath('../bare.git')).toBeNull();
  for (const name of ['../outside', '.git/config', 'git~1/config', 'foo:stream', 'AUX.txt', 'inner/link\\name']) expect(safeGitPath(name)).toBe(false);
  expect(safeGitPath('src/café file.ts')).toBe(true);
});
