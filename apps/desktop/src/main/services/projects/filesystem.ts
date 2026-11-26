import { constants } from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, parse, resolve, sep } from 'node:path';
import { hasControlCharacters, isProjectSegment, isRecord, PROJECT_LIMITS } from '@factory/contracts';
import type { ProjectAvailability } from '@factory/contracts';

export interface DirectoryIdentity {
  device: string;
  file: string;
  created: string;
}

export interface ProjectRoot {
  path: string;
  identity: DirectoryIdentity;
}

export class ProjectPathChanged extends Error {}

export function pathKey(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export function sameDirectory(a: DirectoryIdentity, b: DirectoryIdentity): boolean {
  return a.device === b.device && a.file === b.file && a.created === b.created;
}

export function directoryIdentity(stat: BigIntStats): DirectoryIdentity {
  return { file: String(stat.ino), device: String(stat.dev), created: String(stat.birthtimeNs) };
}

function matchesHandle(before: BigIntStats, after: BigIntStats): boolean {
  const sameVolume = before.dev === after.dev;
  const sameCreationWithUnknownVolume = process.platform === 'win32' && before.dev === 0n
    && before.birthtimeNs === after.birthtimeNs;
  return before.ino === after.ino && (sameVolume || sameCreationWithUnknownVolume);
}

export function pathError(error: unknown): ProjectAvailability {
  if (error instanceof ProjectPathChanged) return 'changed';
  if (isRecord(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return 'missing';
  return 'unavailable';
}

export function isRootPath(path: string): boolean {
  if (!isAbsolute(path) || path.length > PROJECT_LIMITS.absolutePath || hasControlCharacters(path)) return false;
  const root = parse(path).root;
  if (process.platform === 'win32' && /^[\\/]{2}[?.][\\/]/u.test(root)) return false;
  const components = path.slice(root.length).split(process.platform === 'win32' ? /[\\/]/u : sep);
  return components.every((part) => part !== '.' && part !== '..'
    && (process.platform !== 'win32' || !part || isProjectSegment(part)));
}

export async function admitRoot(selection: string): Promise<ProjectRoot> {
  if (!isRootPath(selection)) {
    throw new ProjectPathChanged();
  }
  const selected = await lstat(selection, { bigint: true });
  if (!selected.isDirectory()) throw new ProjectPathChanged();
  const path = await realpath(selection);
  if (!isRootPath(path)) throw new ProjectPathChanged();
  const stat = await checkedDirectory(path, directoryIdentity(selected));
  return { path, identity: directoryIdentity(stat) };
}

export async function checkedDirectory(path: string, identity?: DirectoryIdentity): Promise<BigIntStats> {
  const before = await lstat(path, { bigint: true });
  if (!before.isDirectory() || (identity && !sameDirectory(identity, directoryIdentity(before)))) {
    throw new ProjectPathChanged();
  }
  if (pathKey(await realpath(path)) !== pathKey(path)) throw new ProjectPathChanged();
  const after = await lstat(path, { bigint: true });
  if (!after.isDirectory() || !sameDirectory(directoryIdentity(before), directoryIdentity(after))) {
    throw new ProjectPathChanged();
  }
  return after;
}

export async function withDirectory<T>(
  path: string,
  identity: DirectoryIdentity,
  operation: (listingPath: string) => Promise<T>,
): Promise<T> {
  const expected = await checkedDirectory(path, identity);
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0
    : constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const handle = await open(path, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isDirectory() || !matchesHandle(expected, opened)) throw new ProjectPathChanged();
    await checkedDirectory(path, identity);
    // Linux can enumerate the exact opened directory through procfs.
    const listingPath = process.platform === 'linux' ? `/proc/self/fd/${handle.fd}` : path;
    const result = await operation(listingPath);
    await checkedDirectory(path, identity);
    return result;
  } finally {
    await handle.close();
  }
}

export async function readBoundedFile<T>(
  path: string,
  stat: BigIntStats,
  maxBytes: number,
  decode: (bytes: Buffer) => T,
): Promise<T> {
  if (!stat.isFile() || stat.size > maxBytes) throw new ProjectPathChanged();
  const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK);
  const handle: FileHandle = await open(path, flags);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !matchesHandle(stat, opened) || opened.size > maxBytes) throw new ProjectPathChanged();
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > maxBytes) throw new ProjectPathChanged();
    return decode(buffer.subarray(0, length));
  } finally {
    await handle.close();
  }
}
