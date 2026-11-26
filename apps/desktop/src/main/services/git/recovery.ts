import { randomUUID } from 'node:crypto';
import { lstat, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { GIT_LIMIT, hasExactKeys, isGitOid, isGitRef, isRecord } from '@factory/contracts';
import { syncDirectory } from '../generation/journal';
import { admitRoot, readBoundedFile, withDirectory } from '../projects/filesystem';
import { GitFailure } from './process';
import { pathIsMissing, safeGitPath } from './repository';

export interface Recovery {
  kind: 'merge' | 'rebase' | 'cherry-pick';
  branch: string;
  head: string;
  source: string;
  commits: string[];
  paths: string[];
}

const maxBytes = 1_300_000;

function isRecovery(value: unknown): value is Recovery {
  return isRecord(value) && hasExactKeys(value, ['kind', 'branch', 'head', 'source', 'commits', 'paths'])
    && ['merge', 'rebase', 'cherry-pick'].some((kind) => kind === value.kind)
    && typeof value.branch === 'string' && isGitRef('refs/heads/' + value.branch) && isGitOid(value.head) && isGitOid(value.source)
    && Array.isArray(value.commits) && value.commits.length > 0 && value.commits.length <= 24 && value.commits.every(isGitOid)
    && Array.isArray(value.paths) && value.paths.length <= GIT_LIMIT.changes && value.paths.every((path: unknown) => typeof path === 'string' && safeGitPath(path));
}

export class GitRecoveryStore {
  readonly #records = new Map<string, Recovery>();
  constructor(private readonly data?: string) {}

  async #directory<T>(worktree: string, operation: (folder: string, target: string) => Promise<T>) {
    if (!this.data || !/^[a-f0-9]{64}$/u.test(worktree)) throw new GitFailure('The Git recovery location could not be verified.');
    const root = await admitRoot(this.data);
    return withDirectory(root.path, root.identity, (folder) => operation(folder, join(folder, 'git-recovery-' + worktree + '.json')));
  }

  async read(worktree: string): Promise<Recovery | undefined> {
    if (!this.data) return this.#records.get(worktree);
    return this.#directory(worktree, async (_folder, target) => {
      let stat;
      try { stat = await lstat(target, { bigint: true }); }
      catch (error) { if (pathIsMissing(error)) return undefined; throw error; }
      const value = await readBoundedFile(target, stat, maxBytes, (bytes) => JSON.parse(bytes.toString('utf8')) as unknown);
      if (!isRecovery(value)) throw new GitFailure('The Git recovery record could not be verified. Inspect the operation in your Git client.');
      return value;
    });
  }

  async save(worktree: string, value: Recovery) {
    if (!this.data) { this.#records.set(worktree, value); return; }
    return this.#directory(worktree, async (folder, target) => {
      const contents = JSON.stringify(value) + '\n';
      if (Buffer.byteLength(contents) > maxBytes) throw new GitFailure('The Git recovery record is too large.');
      const temporary = join(folder, 'git-recovery-' + randomUUID() + '.tmp');
      const file = await open(temporary, 'wx', 0o600);
      try {
        try { await file.writeFile(contents); await file.sync(); }
        finally { await file.close(); }
        await rename(temporary, target);
        await syncDirectory(folder);
      } finally { await unlink(temporary).catch(() => undefined); }
    });
  }

  async remove(worktree: string) {
    if (!this.data) { this.#records.delete(worktree); return; }
    return this.#directory(worktree, async (folder, target) => {
      try { await unlink(target); } catch (error) { if (!pathIsMissing(error)) throw error; }
      await syncDirectory(folder);
    });
  }
}
