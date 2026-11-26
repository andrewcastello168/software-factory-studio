import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { GENERATOR_LIMITS, hasExactKeys, isGeneratorDigest, isGeneratorPath, isProjectId, isRecord, isStarterConfig } from '@factory/contracts';
import type { StarterConfig } from '@factory/contracts';
import { admitRoot, checkedDirectory, directoryIdentity, isRootPath, readBoundedFile, withDirectory } from '../projects/filesystem';
import type { DirectoryIdentity, ProjectRoot } from '../projects/filesystem';

const MAX_JOURNAL = 48_000;

export interface GenerationRecord {
  version: 1;
  id: string;
  projectId: string;
  digest: string;
  config: StarterConfig;
  parent: ProjectRoot;
  directories: Record<string, DirectoryIdentity>;
  createdFiles: number;
}

const hasCode = (error: unknown, code: string) => isRecord(error) && error.code === code;

export async function optionalStat(path: string) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null;
    throw error;
  }
}

function isDirectoryIdentity(value: unknown): value is DirectoryIdentity {
  return isRecord(value) && hasExactKeys(value, ['device', 'file', 'created'])
    && [value.device, value.file, value.created].every((field) => typeof field === 'string' && /^-?\d{1,30}$/u.test(field));
}

function isParent(value: unknown): value is ProjectRoot {
  return isRecord(value) && hasExactKeys(value, ['path', 'identity'])
    && typeof value.path === 'string' && isRootPath(value.path) && isDirectoryIdentity(value.identity);
}

function isGenerationRecord(value: unknown): value is GenerationRecord {
  return isRecord(value) && hasExactKeys(value, [
    'version', 'id', 'projectId', 'digest', 'config', 'parent', 'directories', 'createdFiles',
  ]) && value.version === 1 && isProjectId(value.id) && isProjectId(value.projectId)
    && isGeneratorDigest(value.digest) && isStarterConfig(value.config) && isParent(value.parent)
    && typeof value.createdFiles === 'number' && Number.isInteger(value.createdFiles)
    && value.createdFiles >= 0 && value.createdFiles <= GENERATOR_LIMITS.files
    && isRecord(value.directories) && Object.keys(value.directories).length <= GENERATOR_LIMITS.files
    && Object.entries(value.directories).every(([path, identity]) => (path === '' || isGeneratorPath(path)) && isDirectoryIdentity(identity));
}

export async function syncDirectory(path: string) {
  if (process.platform !== 'linux') return;
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class GenerationJournal {
  #location: ProjectRoot | undefined;
  constructor(private readonly userData: string) {}

  async #root(create: boolean) {
    const data = await admitRoot(this.userData);
    const path = join(data.path, 'generation-v1');
    return withDirectory(data.path, data.identity, async (opened) => {
      const storage = join(opened, 'generation-v1');
      if (!await optionalStat(storage)) {
        if (!create) {
          if (this.#location) throw new Error('Generation journal was moved.');
          return undefined;
        }
        await mkdir(storage, { mode: 0o700 });
        await syncDirectory(opened);
      }
      const identity = directoryIdentity(await checkedDirectory(path, this.#location?.identity));
      this.#location = { path, identity };
      return this.#location;
    });
  }

  async list(): Promise<GenerationRecord[]> {
    const root = await this.#root(false);
    if (!root) return [];
    return withDirectory(root.path, root.identity, async (opened) => {
      const names = (await readdir(opened)).filter((name) => name.endsWith('.json'));
      if (names.length > GENERATOR_LIMITS.pending) throw new Error('Generation journal is full.');
      const records: GenerationRecord[] = [];
      for (const name of names.sort()) {
        const id = name.slice(0, -5);
        if (!isProjectId(id)) throw new Error('Unknown journal record.');
        const path = join(opened, name);
        const stat = await lstat(path, { bigint: true });
        const record = await readBoundedFile(path, stat, MAX_JOURNAL, (bytes) => JSON.parse(bytes.toString('utf8')) as unknown);
        if (!isGenerationRecord(record) || record.id !== id) throw new Error('Unreadable generation record.');
        records.push(record);
      }
      return records;
    });
  }

  async save(record: GenerationRecord, initial = false) {
    const root = await this.#root(true);
    if (!root) throw new Error('Missing generation journal.');
    await withDirectory(root.path, root.identity, async (opened) => {
      const temporary = join(opened, randomUUID() + '.tmp');
      const path = join(opened, record.id + '.json');
      const content = JSON.stringify(record) + '\n';
      if (!isGenerationRecord(record) || Buffer.byteLength(content) > MAX_JOURNAL) throw new Error('Invalid generation journal.');
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        if (initial) {
          await link(temporary, path);
          await unlink(temporary);
        } else {
          const previous = await lstat(path, { bigint: true });
          if (!previous.isFile()) throw new Error('Invalid generation journal file.');
          await rename(temporary, path);
        }
        await syncDirectory(opened);
      } finally {
        await unlink(temporary).catch(() => undefined);
      }
    });
  }

  async finish(id: string) {
    const root = await this.#root(false);
    if (!root) throw new Error('Missing generation journal.');
    await withDirectory(root.path, root.identity, async (opened) => {
      await unlink(join(opened, id + '.json'));
      await syncDirectory(opened);
    });
  }
}
