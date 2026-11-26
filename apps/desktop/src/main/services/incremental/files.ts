import { lstat, mkdir, opendir, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { TextDecoder } from 'node:util';
import { INCREMENTAL_LIMITS } from '@factory/contracts';
import type { IncrementalChange } from '@factory/contracts';
import { sha256 } from '@factory/generator';
import type { LocalFile } from '@factory/generator';
import { assertVacant, publish } from '../generation/transaction';
import { optionalStat, syncDirectory } from '../generation/journal';
import { checkedDirectory, directoryIdentity, readBoundedFile, sameDirectory, withDirectory } from '../projects/filesystem';
import type { DirectoryIdentity, ProjectRoot } from '../projects/filesystem';

export class FileConflict extends Error {}

export async function readDirectory(root: ProjectRoot, path: string): Promise<ProjectRoot | null> {
  let current = root;
  for (const name of path === '.' ? [] : path.split('/')) {
    const parent = current;
    const found = await withDirectory(parent.path, parent.identity, async (opened) => {
      const next = join(parent.path, name);
      if (!await exactName(opened, name)) return null;
      const entry = await lstat(join(opened, name), { bigint: true });
      if (!entry.isDirectory()) throw new FileConflict();
      const identity = directoryIdentity(entry);
      await checkedDirectory(next, identity);
      return { path: next, identity };
    });
    if (!found) return null;
    current = found;
  }
  return current;
}

async function exactName(directory: string, name: string) {
  const entries = await opendir(directory);
  let exact = false;
  let count = 0;
  for await (const entry of entries) {
    if (++count > 25_000) throw new FileConflict();
    if (entry.name.normalize('NFC').toLowerCase() !== name.toLowerCase()) continue;
    if (entry.name !== name) throw new FileConflict();
    exact = true;
  }
  return exact;
}

async function readAt(directory: string, name: string): Promise<LocalFile> {
  const path = join(directory, name);
  const stat = await optionalStat(path);
  if (!stat) return { state: 'absent' };
  if (!stat.isFile() || stat.nlink !== 1n) return { state: 'unsafe' };
  const content = await readBoundedFile(path, stat, INCREMENTAL_LIMITS.bytes, (data) =>
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data));
  return content.includes('\0') ? { state: 'unsafe' } : { state: 'text', content, sha256: sha256(content) };
}

export async function inspectFile(root: ProjectRoot, relative: string): Promise<LocalFile> {
  try {
    const directory = await readDirectory(root, dirname(relative).replaceAll('\\', '/'));
    if (!directory) return { state: 'absent' };
    return await withDirectory(directory.path, directory.identity, async (opened) => {
      const name = basename(relative);
      if (!await exactName(opened, name)) return { state: 'absent' };
      return readAt(opened, name);
    });
  } catch { return { state: 'unsafe' }; }
}

export const hashFile = (file: LocalFile) => file.state === 'text' ? file.sha256 : file.state;

export type Write = IncrementalChange & { action: 'create' | 'modify'; after: string };
export const isWrite = (c: IncrementalChange): c is Write => (c.action === 'create' || c.action === 'modify') && c.after !== null;

export function parents(writes: Write[]) {
  const paths = new Set<string>();
  for (const { path } of writes) {
    const segments = path.split('/').slice(0, -1);
    for (let depth = 1; depth <= segments.length; depth++) paths.add(segments.slice(0, depth).join('/'));
  }
  return [...paths];
}

export type ParentState = Record<string, DirectoryIdentity | null>;

export async function snapshotParents(root: ProjectRoot, writes: Write[]) {
  const entries = await Promise.all(parents(writes).map(async (path) => [path, (await readDirectory(root, path))?.identity ?? null] as const));
  return Object.fromEntries(entries) as ParentState;
}

async function checkedParent(root: ProjectRoot, path: string, expected: ParentState) {
  const actual = await readDirectory(root, path);
  const identity = path === '.' ? root.identity : expected[path];
  if (!actual || !identity || !sameDirectory(actual.identity, identity)) throw new FileConflict();
  return actual;
}

const backupName = (id: string, index: number) => '.factory-incremental-backup-' + id + '-' + index;
const stageName = (id: string, index: number) => '.factory-incremental-stage-' + id + '-' + index;
const oldHash = (write: Write) => write.before === null ? 'absent' : sha256(write.before);
const newHash = (write: Write) => sha256(write.after);

async function hashes(directory: ProjectRoot, write: Write, id: string, index: number) {
  return withDirectory(directory.path, directory.identity, async (opened) => {
    const names = [basename(write.path), backupName(id, index), stageName(id, index)];
    // A crash during exclusive publication can leave the same staged inode under
    // the target and staging names. The shared publisher verifies both bytes.
    const state = async (name: string) => {
      if (!await exactName(opened, name)) return 'absent';
      const path = join(opened, name);
      const stat = await lstat(path, { bigint: true });
      return !stat.isFile() ? 'unsafe' : readBoundedFile(path, stat, INCREMENTAL_LIMITS.bytes, sha256);
    };
    const [live, backup, stage] = await Promise.all(names.map(state));
    return { live: live!, backup: backup!, stage: stage! };
  });
}

export async function applyFiles(
  root: ProjectRoot, id: string, writes: Write[], expected: ParentState,
  save: () => Promise<void>, authorize: () => Promise<void>, recovering: boolean,
) {
  const directories = parents(writes);
  if (Object.keys(expected).length !== directories.length) throw new FileConflict();
  for (const name of directories) {
    const recorded = expected[name];
    const actual = await readDirectory(root, name);
    if (recorded ? !actual || !sameDirectory(actual.identity, recorded) : actual !== null) throw new FileConflict();
  }
  const state = (directory: ProjectRoot, write: Write, index: number) => hashes(directory, write, id, index);
  // Check every existing destination before resuming any part of the plan.
  for (const [index, write] of writes.entries()) {
    const parent = dirname(write.path).replaceAll('\\', '/');
    if (parent !== '.' && !expected[parent]) continue;
    const { live, backup, stage } = await state(await checkedParent(root, parent, expected), write, index);
    const old = oldHash(write);
    const next = newHash(write);
    if (!recovering && (live !== old || backup !== 'absent' || stage !== 'absent')) throw new FileConflict();
    if ((stage !== 'absent' && stage !== next)
      || (write.action === 'create' ? backup !== 'absent' || (live !== 'absent' && live !== next)
        : !((live === old && backup === 'absent') || (live === 'absent' && backup === old)
          || (live === next && (backup === old || backup === 'absent'))))) throw new FileConflict();
  }

  for (const name of directories) {
    if (expected[name]) continue;
    await authorize();
    const parent = await checkedParent(root, dirname(name).replaceAll('\\', '/'), expected);
    await withDirectory(parent.path, parent.identity, async (opened) => {
      await mkdir(join(opened, basename(name)), { mode: 0o700 });
      const created = await lstat(join(opened, basename(name)), { bigint: true });
      if (!created.isDirectory()) throw new FileConflict();
      expected[name] = directoryIdentity(created);
      await syncDirectory(opened);
    });
    await save();
  }

  for (const [index, write] of writes.entries()) {
    const parent = await checkedParent(root, dirname(write.path).replaceAll('\\', '/'), expected);
    const observed = await state(parent, write, index);
    const old = oldHash(write);
    const next = newHash(write);
    if (observed.live === next) continue;
    const name = basename(write.path);
    const backup = backupName(id, index);
    if (write.action === 'modify' && observed.live === old && observed.backup === 'absent') {
      await assertVacant(parent, backup);
      await authorize();
      await withDirectory(parent.path, parent.identity, async (opened) => {
        if (!await exactName(opened, name) || await exactName(opened, backup)
          || hashFile(await readAt(opened, name)) !== old) throw new FileConflict();
        await rename(join(opened, name), join(opened, backup));
        await syncDirectory(opened);
      });
    }
    const checkpoint = await state(parent, write, index);
    if (checkpoint.live !== 'absent' || checkpoint.backup !== old || ![next, 'absent'].includes(checkpoint.stage)) throw new FileConflict();
    await publish(parent, name, stageName(id, index), write.after, next, authorize);
  }

  for (const [index, write] of writes.entries()) {
    const parent = await checkedParent(root, dirname(write.path).replaceAll('\\', '/'), expected);
    const observed = await state(parent, write, index);
    if (observed.live !== newHash(write) || !['absent', oldHash(write)].includes(observed.backup)
      || !['absent', newHash(write)].includes(observed.stage)) throw new FileConflict();
  }
  await authorize();
  for (const [index, write] of writes.entries()) {
    const parent = await checkedParent(root, dirname(write.path).replaceAll('\\', '/'), expected);
    const observed = await state(parent, write, index);
    await withDirectory(parent.path, parent.identity, async (opened) => {
      const remove = async (name: string, digest: string) => {
        const path = join(opened, name);
        const stat = await optionalStat(path);
        if (stat && (!stat.isFile() || await readBoundedFile(path, stat, INCREMENTAL_LIMITS.bytes, sha256) !== digest)) throw new FileConflict();
        if (stat) await unlink(path);
      };
      if (observed.stage !== 'absent') await remove(stageName(id, index), newHash(write));
      if (observed.backup !== 'absent') await remove(backupName(id, index), oldHash(write));
      if (hashFile(await readAt(opened, basename(write.path))) !== newHash(write)) throw new FileConflict();
      await syncDirectory(opened);
    });
  }
}
