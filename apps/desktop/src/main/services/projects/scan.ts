import { lstat, opendir, realpath } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import { join } from 'node:path';
import { hasControlCharacters, isProjectId, isProjectSegment, isRecord, PROJECT_LIMITS } from '@factory/contracts';
import type { ProjectEntry, ProjectMetadata } from '@factory/contracts';
import { checkedDirectory, directoryIdentity, pathError, pathKey, readBoundedFile, withDirectory } from './filesystem';
import type { DirectoryIdentity, ProjectRoot } from './filesystem';

const MAX_METADATA_BYTES = 16 * 1024;
const MAX_WATCHED_DIRECTORIES = 128;
const excluded = new Set(['.git', 'node_modules']);

export function isExcludedProjectEntry(name: string): boolean {
  return excluded.has(name.toLowerCase());
}

interface ScanDirectory {
  path: string;
  relative: string;
  identity: DirectoryIdentity;
  parent: ScanDirectory | null;
}

export interface ProjectScan {
  entries: ProjectEntry[];
  metadata: ProjectMetadata;
  watched: { path: string; identity: DirectoryIdentity }[];
  partial: boolean;
}

function decodeMetadata(bytes: Buffer): ProjectMetadata {
  let data: unknown;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { status: 'invalid' };
  }
  if (!isRecord(data)) return { status: 'invalid' };
  if (typeof data.version === 'number' && Number.isSafeInteger(data.version) && data.version > 1) {
    return { status: 'unsupported' };
  }
  if (data.version !== 1 || !isProjectId(data.id)) return { status: 'invalid' };
  const { name, type, stackId, profileId } = data;
  if ([name, type, stackId, profileId].some((value) => value !== undefined
    && (typeof value !== 'string' || !value.trim() || value.length > 120 || hasControlCharacters(value)))) {
    return { status: 'invalid' };
  }
  return {
    status: 'managed',
    descriptor: {
      id: data.id.toLowerCase(),
      name: typeof name === 'string' ? name.trim() : null,
      type: typeof type === 'string' ? type : null,
      stackId: typeof stackId === 'string' ? stackId : null,
      profileId: typeof profileId === 'string' ? profileId : null,
    },
  };
}

export async function readProjectMetadata(root: ProjectRoot): Promise<ProjectMetadata> {
  try {
    return await withDirectory(root.path, root.identity, async (listingPath) => {
      const folder = join(root.path, '.factory');
      const before = await lstat(join(listingPath, '.factory'), { bigint: true });
      if (!before.isDirectory()) return { status: 'blocked' };
      return withDirectory(folder, directoryIdentity(before), async (descriptorPath) => {
        const path = join(descriptorPath, 'project.json');
        const info = await lstat(path, { bigint: true });
        if (!info.isFile()) return { status: 'blocked' };
        if (info.size > MAX_METADATA_BYTES) return { status: 'invalid' };
        if (pathKey(await realpath(path)) !== pathKey(join(folder, 'project.json'))) return { status: 'blocked' };
        return readBoundedFile(path, info, MAX_METADATA_BYTES, decodeMetadata);
      });
    });
  } catch (error) {
    return { status: pathError(error) === 'missing' ? 'absent' : 'blocked' };
  }
}

async function checkParents(directory: ScanDirectory) {
  for (let parent = directory.parent; parent; parent = parent.parent) {
    await checkedDirectory(parent.path, parent.identity);
  }
}

function entryFrom(relative: string, info: BigIntStats): ProjectEntry | null {
  if (info.isSymbolicLink()) return { path: relative, kind: 'link', modifiedAt: null, size: null };
  if (info.isDirectory()) return { path: relative, kind: 'directory', modifiedAt: null, size: null };
  if (info.isFile()) {
    return {
      path: relative,
      kind: 'file',
      modifiedAt: Number(info.mtimeNs) / 1_000_000,
      size: info.size <= Number.MAX_SAFE_INTEGER ? Number(info.size) : null,
    };
  }
  return null;
}

export async function scanProject(root: ProjectRoot, excludedAtRoot: readonly string[] = []): Promise<ProjectScan> {
  const entries: ProjectEntry[] = [];
  const queue: ScanDirectory[] = [{ ...root, relative: '', parent: null }];
  const watched: ProjectScan['watched'] = [];
  let reviewed = 0;
  let partial = false;

  for (const directory of queue) {
    if (reviewed >= PROJECT_LIMITS.entries) {
      partial = true;
      break;
    }
    const candidates: { entry: ProjectEntry; directory: ScanDirectory | null }[] = [];
    try {
      await checkParents(directory);
      await withDirectory(directory.path, directory.identity, async (listingPath) => {
        const handle = await opendir(listingPath);
        const aliases = new Map<string, string>();
        const conflicts = new Set<string>();
        try {
          while (reviewed < PROJECT_LIMITS.entries) {
            const item = await handle.read();
            if (!item) break;
            reviewed++;
            const name = item.name;
            if (!isProjectSegment(name)) {
              partial = true;
              continue;
            }
            if (isExcludedProjectEntry(name) || (!directory.relative && excludedAtRoot.includes(name.toLowerCase()))) continue;

            // Recheck actual entries at the requested path, including Windows junctions.
            const key = name.normalize('NFC');
            const alias = process.platform === 'win32' || process.platform === 'darwin' ? key.toLowerCase() : key;
            const other = aliases.get(alias);
            if (other && other !== name) {
              conflicts.add(other);
              conflicts.add(name);
              partial = true;
              continue;
            }
            aliases.set(alias, name);
            const relative = directory.relative ? `${directory.relative}/${name}` : name;
            if (relative.length > PROJECT_LIMITS.relativePath) {
              partial = true;
              continue;
            }
            try {
              const info = await lstat(join(listingPath, name), { bigint: true });
              const entry = entryFrom(relative, info);
              if (!entry) {
                partial = true;
                continue;
              }
              let child: ScanDirectory | null = null;
              if (entry.kind === 'directory') {
                const path = join(directory.path, name);
                if (pathKey(await realpath(path)) !== pathKey(path)) {
                  candidates.push({ entry: { ...entry, kind: 'link' }, directory: null });
                  continue;
                }
                if (relative.split('/').length >= PROJECT_LIMITS.depth) partial = true;
                else child = { path, relative, identity: directoryIdentity(info), parent: directory };
              }
              candidates.push({ entry, directory: child });
            } catch {
              partial = true;
            }
          }
          if (reviewed === PROJECT_LIMITS.entries && await handle.read()) partial = true;
        } finally {
          await handle.close();
        }
        for (let index = candidates.length - 1; index >= 0; index--) {
          const name = candidates[index]?.entry.path.split('/').at(-1);
          if (name && conflicts.has(name)) candidates.splice(index, 1);
        }
      });
      await checkParents(directory);
    } catch (error) {
      if (!directory.parent) throw error;
      partial = true;
      continue;
    }
    if (watched.length < MAX_WATCHED_DIRECTORIES) watched.push({ path: directory.path, identity: directory.identity });
    candidates.sort((a, b) => a.entry.path.localeCompare(b.entry.path, 'en', { numeric: true })
      || (a.entry.path < b.entry.path ? -1 : a.entry.path > b.entry.path ? 1 : 0));
    for (const candidate of candidates) {
      entries.push(candidate.entry);
      if (candidate.directory) queue.push(candidate.directory);
    }
  }
  const metadata = await readProjectMetadata(root);
  await checkedDirectory(root.path, root.identity);
  return { entries, metadata, watched, partial };
}
