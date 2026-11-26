import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { success } from '@factory/contracts';
import type { GitAction, GitActionInput, GitRepository, GitReviewInput, GitScope, Result } from '@factory/contracts';
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
  await mkdir(join(fixture, 'Profile'));
  service = createService();
});

function createService() {
  return new GitStudio({
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
  }, join(fixture, 'Profile'));
}

afterEach(async () => {
  await service?.dispose();
  if (fixture) await rm(fixture, { recursive: true, force: true, maxRetries: 4 });
});

describe('native Git workspace', () => {
  it('initializes explicitly, inspects an unborn branch, stages, unstages and commits only the selected content', { timeout: 15_000 }, async () => {
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


type ReviewInput = GitReviewInput extends infer Value ? Value extends GitScope ? Omit<Value, keyof GitScope> : never : never;

async function review(input: ReviewInput) {
  const result = unwrap(await service.advanced.review({ id, revision: (await status()).revision, ...input }));
  if (!result) throw new Error('The fixture did not authorize a required directory.');
  return result;
}
async function advanced(input: ReviewInput) {
  const plan = await review(input);
  if (!plan.ticket) throw new Error(plan.blocked ?? 'The review did not allow a write.');
  return unwrap(await service.advanced.apply({ id, ticket: plan.ticket }));
}
async function details(key = id) {
  const state = unwrap(await service.status(key));
  if (state.state !== 'repository') throw new Error(JSON.stringify(state));
  return unwrap(await service.advanced.details({ id: key, revision: state.revision }));
}

it('isolates approved linked worktree grants and guards registration, checkout and removal', { timeout: 60_000 }, async () => {
  const before = await baseline();
  choices = [fixture];
  const created = await advanced({ kind: 'worktree-add', ref: 'refs/heads/main', folder: 'Feature café', branch: 'feature' });
  expect(created, created.message).toMatchObject({ level: 'success', selection: { projectId: cloned } });
  const linked = join(fixture, 'Feature café');
  const second = join(fixture, 'Parallel feature');
  git(work, 'worktree', 'add', '-b', 'parallel', second, 'main');
  await writeFile(join(second, 'parallel.txt'), 'independent patch\n');
  git(second, 'add', '--', 'parallel.txt');
  git(second, 'commit', '-m', 'Independent feature');
  expect(existsSync(join(linked, 'parallel.txt'))).toBe(false);
  expect(existsSync(join(work, 'parallel.txt'))).toBe(false);
  const state = unwrap(await service.status(cloned));
  expect(state).toMatchObject({ state: 'repository', branch: 'feature', head: before.head, repositoryId: before.repositoryId });
  expect(state.state === 'repository' && state.worktreeId).not.toBe(before.worktreeId);
  const blocked = await review({ kind: 'switch', ref: 'refs/heads/feature' });
  expect(blocked.blocked).toContain('checked out');
  expect(blocked.ticket).toBeNull();
  await writeFile(join(linked, 'app.txt'), 'feature-only\n');
  expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('original\n');
  let row = (await details()).worktrees.findIndex(({ branch }) => branch === 'refs/heads/feature');
  expect(row).toBeGreaterThan(0);
  choices = [linked];
  expect((await review({ kind: 'worktree-remove', row, path: linked })).blocked).toContain('dirty');
  await writeFile(join(linked, 'app.txt'), 'original\n');
  git(work, 'worktree', 'lock', linked);
  expect((await review({ kind: 'worktree-remove', row, path: linked })).blocked).toContain('locked');
  git(work, 'worktree', 'unlock', linked);
  choices = [linked];
  expect((await advanced({ kind: 'worktree-open', row, path: linked })).selection?.projectId).toBe(cloned);
  grants.delete(cloned);
  expect(await service.status(cloned)).toEqual({ ok: false, error: 'ACCESS_DENIED' });
  choices = [linked];
  expect(await advanced({ kind: 'worktree-remove', row, path: linked })).toMatchObject({ level: 'success' });
  expect(existsSync(linked)).toBe(false);
  expect(git(work, 'rev-parse', 'feature')).toBe(before.head);
  git(work, 'worktree', 'add', '-b', 'missing', linked, 'main');
  await rename(linked, join(fixture, 'Moved checkout'));
  row = (await details()).worktrees.findIndex(({ branch }) => branch === 'refs/heads/missing');
  expect((await details()).worktrees[row]).toMatchObject({ missing: true });
  expect((await review({ kind: 'worktree-remove', row, path: linked })).ticket).toBeNull();
});

it('previews dirty branch transitions, stashes tracked and explicitly included untracked files and preserves index', { timeout: 60_000 }, async () => {
  await baseline();
  git(work, 'branch', 'topic');
  await writeFile(join(work, 'app.txt'), 'staged\n');
  git(work, 'add', 'app.txt');
  await writeFile(join(work, 'app.txt'), 'unstaged\n');
  await writeFile(join(work, 'notes.txt'), 'untracked\n');
  const blocked = await review({ kind: 'switch', ref: 'refs/heads/topic' });
  expect(blocked.files).toEqual(expect.arrayContaining(['MM app.txt', '?? notes.txt']));
  expect(blocked.ticket).toBeNull();
  expect((await advanced({ kind: 'stash-create', message: 'Save working draft', untracked: true })).level).toBe('success');
  expect((await status()).changes).toHaveLength(0);
  expect((await advanced({ kind: 'switch', ref: 'refs/heads/topic' })).level).toBe('success');
  const stash = (await details()).stashes[0]!;
  expect((await review({ kind: 'stash-inspect', row: 0, oid: stash.oid })).patch?.text).toContain('+unstaged');
  expect((await advanced({ kind: 'stash-pop', row: 0, oid: stash.oid })).level).toBe('success');
  expect((await status()).changes).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'app.txt', index: 'M', worktree: 'M' })]));
  expect(await readFile(join(work, 'notes.txt'), 'utf8')).toBe('untracked\n');
  expect((await details()).stashes).toHaveLength(0);
});

async function divergent() {
  await baseline();
  git(work, 'switch', '-c', 'topic');
  await writeFile(join(work, 'app.txt'), 'topic content\n');
  git(work, 'commit', '-am', 'Reviewed topic change');
  const topic = git(work, 'rev-parse', 'HEAD');
  git(work, 'switch', 'main');
  await writeFile(join(work, 'app.txt'), 'main content\n');
  git(work, 'commit', '-am', 'Reviewed main change');
  return { topic, main: git(work, 'rev-parse', 'HEAD') };
}

it('reviews divergent merges and lets editors resolve or abort with scoped conflict evidence', { timeout: 60_000 }, async () => {
  const { main } = await divergent();
  const planned = await review({ kind: 'merge', source: 'refs/heads/topic', strategy: 'merge' });
  expect(planned.detail).toContain('diverged');
  expect(planned.patch?.text).toContain('topic content');
  expect((await advanced({ kind: 'merge', source: 'refs/heads/topic', strategy: 'merge' })).status).toMatchObject({ operation: 'merge' });
  await service.dispose();
  service = createService();
  expect((await details())).toMatchObject({ conflicts: ['app.txt'], recovery: true });
  const conflict = await review({ kind: 'conflict-inspect', row: 0 });
  expect(conflict.versions.map(({ value }) => value.text.trim())).toEqual(['original', 'main content', 'topic content']);
  expect((await review({ kind: 'conflict-stage', row: 0 })).blocked).toContain('Conflict markers');
  expect((await advanced({ kind: 'abort' })).level).toBe('success');
  expect(git(work, 'rev-parse', 'HEAD')).toBe(main);
  expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('main content\n');
  expect((await advanced({ kind: 'merge', source: 'refs/heads/topic', strategy: 'merge' })).level).toBe('warning');
  await writeFile(join(work, 'app.txt'), 'reviewed resolution\n');
  expect((await advanced({ kind: 'conflict-stage', row: 0 })).level).toBe('success');
  expect((await advanced({ kind: 'continue' })).level).toBe('success');
  expect(git(work, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3);
});

it('replays reviewed unpublished commits and supports cherry-pick conflicts with explicit recovery', { timeout: 60_000 }, async () => {
  const { topic, main } = await divergent();
  const inProgress = await advanced({ kind: 'rebase', source: 'refs/heads/topic' });
  expect(inProgress, inProgress.message).toMatchObject({ level: 'warning', status: { operation: 'rebase', branch: null } });
  expect((await review({ kind: 'conflict-inspect', row: 0 })).detail).toContain('Ours is the upstream');
  await writeFile(join(work, 'app.txt'), 'reviewed rebase\n');
  expect((await advanced({ kind: 'conflict-stage', row: 0 })).level).toBe('success');
  const continued = await advanced({ kind: 'continue' });
  expect(continued, continued.message).toMatchObject({ level: 'success', status: { operation: null, branch: 'main' } });
  expect(git(work, 'rev-parse', 'HEAD^')).toBe(topic);
  const rebased = git(work, 'rev-parse', 'HEAD');
  expect(rebased).not.toBe(main);
  const pick = await advanced({ kind: 'cherry-pick', source: main });
  expect(pick, pick.message).toMatchObject({ level: 'warning', status: { operation: 'cherry-pick' } });
  expect((await advanced({ kind: 'abort' })).level).toBe('success');
  expect(git(work, 'rev-parse', 'HEAD')).toBe(rebased);
  expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('reviewed rebase\n');
});

it('rejects advanced reviews after branch and worktree drift, and serializes native writes', { timeout: 45_000 }, async () => {
  const first = await baseline();
  git(work, 'branch', 'topic');
  const plan = await review({ kind: 'switch', ref: 'refs/heads/topic' });
  expect(plan.ticket).toBeTruthy();
  let resume!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { started = resolve; });
  approve = async () => {
    started();
    await new Promise<void>((resolve) => { resume = resolve; });
    git(work, 'branch', 'extra-drift');
    return true;
  };
  const pending = service.advanced.apply({ id, ticket: plan.ticket! });
  await waiting;
  const parallel = await service.action({ id, revision: first.revision, operation: 'create', name: 'concurrent' });
  expect(parallel).toEqual({ ok: false, error: 'PROJECT_BUSY' });
  resume();
  expect(unwrap(await pending).level).toBe('error');
  expect(git(work, 'branch', '--show-current')).toBe('main');
});


it('blocks unexpected linked metadata and never follows a junction-backed destination', { timeout: 45_000 }, async () => {
  await baseline();
  const linked = join(fixture, 'Linked review');
  const outside = join(fixture, 'Outside');
  await mkdir(outside);
  const alias = join(fixture, 'Alias');
  await symlink(outside, alias, process.platform === 'win32' ? 'junction' : 'dir');
  choices = [alias];
  expect((await review({ kind: 'worktree-add', ref: 'refs/heads/main', folder: 'Child', branch: 'branch' })).ticket).toBeNull();
  expect(existsSync(join(outside, 'Child'))).toBe(false);
  git(work, 'worktree', 'add', '-b', 'branch', linked, 'main');
  grants.set(cloned, await admitRoot(linked));
  const associated = await readFile(join(linked, '.git'), 'utf8');
  await writeFile(join(associated.trim().slice(8), 'gitdir'), join(outside, '.git') + '\n');
  expect(unwrap(await service.status(cloned)).state).toBe('unsupported');
  expect(existsSync(join(outside, '.git'))).toBe(false);
});

it('guards published rebase ranges, branch deletion and selected-file replacement', { timeout: 60_000 }, async () => {
  const { main, topic } = await divergent();
  git(work, 'update-ref', 'refs/remotes/origin/published', main);
  expect((await review({ kind: 'rebase', source: 'refs/heads/topic' })).blocked).toContain('may already be published');
  expect((await review({ kind: 'branch-delete', ref: 'refs/heads/topic' })).blocked).toContain('already merged');
  git(work, 'branch', 'backup');
  expect((await advanced({ kind: 'branch-rename', ref: 'refs/heads/backup', name: 'renamed' })).level).toBe('success');
  expect((await advanced({ kind: 'branch-delete', ref: 'refs/heads/renamed' })).level).toBe('success');
  const changed = await advanced({ kind: 'file-replace', ref: 'refs/heads/topic', path: 'app.txt' });
  expect(changed, changed.message).toMatchObject({ level: 'success', status: { head: main, branch: 'main' } });
  expect(await readFile(join(work, 'app.txt'), 'utf8')).toBe('topic content\n');
  expect(git(work, 'rev-parse', 'topic')).toBe(topic);
  expect((await status()).changes).toMatchObject([{ index: '.', worktree: 'M' }]);
});

it('keeps shared stash entries after conflicts and blocks common credential paths', { timeout: 55_000 }, async () => {
  await baseline();
  await writeFile(join(work, 'app.txt'), 'saved alternative\n');
  await writeFile(join(work, '.env.local'), 'FIXTURE=value\n');
  expect((await review({ kind: 'stash-create', message: 'Credentials excluded', untracked: true })).blocked).toContain('credentials');
  expect((await advanced({ kind: 'stash-create', message: 'Save only tracked', untracked: false })).level).toBe('success');
  expect(await readFile(join(work, '.env.local'), 'utf8')).toBe('FIXTURE=value\n');
  await rm(join(work, '.env.local'));
  await writeFile(join(work, 'app.txt'), 'new branch content\n');
  git(work, 'commit', '-am', 'New conflicting commit');
  const entry = (await details()).stashes[0]!;
  expect((await advanced({ kind: 'stash-pop', row: 0, oid: entry.oid })).level).toBe('warning');
  expect((await details()).stashes[0]?.oid).toBe(entry.oid);
});
