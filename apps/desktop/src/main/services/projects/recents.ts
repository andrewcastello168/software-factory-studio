import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { hasExactKeys, isProjectId, isRecord, PROJECT_LIMITS } from '@factory/contracts';
import type { RecentProject } from '@factory/contracts';
import { isRootPath, pathKey, readBoundedFile } from './filesystem';
import type { DirectoryIdentity } from './filesystem';

const MAX_BYTES = 4 * 1024 * 1024;

export interface RecentReference extends Omit<RecentProject, 'availability'> {
  identity: DirectoryIdentity;
  projectId: string | null;
}

function isIdentity(value: unknown): value is DirectoryIdentity {
  return isRecord(value) && hasExactKeys(value, ['device', 'file', 'created'])
    && [value.device, value.file, value.created].every((field) => typeof field === 'string' && /^-?\d{1,30}$/.test(field));
}

function isReference(value: unknown): value is RecentReference {
  return isRecord(value) && hasExactKeys(value, ['id', 'name', 'directory', 'identity', 'projectId'])
    && isProjectId(value.id) && isIdentity(value.identity) && (value.projectId === null || isProjectId(value.projectId))
    && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 255 && !value.name.includes('\0')
    && typeof value.directory === 'string' && value.directory.length <= PROJECT_LIMITS.absolutePath
    && isRootPath(value.directory);
}

export class RecentStore {
  constructor(private readonly file: string) {}

  async isInside(project: string): Promise<boolean> {
    let directory = dirname(this.file);
    const missing: string[] = [];
    for (;;) {
      try {
        const canonical = join(await realpath(directory), ...missing.reverse());
        const path = relative(pathKey(project), pathKey(canonical));
        return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
      } catch (error) {
        const parent = dirname(directory);
        if (!isRecord(error) || error.code !== 'ENOENT' || parent === directory) return true;
        missing.push(basename(directory));
        directory = parent;
      }
    }
  }

  async load(): Promise<RecentReference[] | null> {
    try {
      const stat = await lstat(this.file, { bigint: true });
      return await readBoundedFile(this.file, stat, MAX_BYTES, (bytes) => {
        const data: unknown = JSON.parse(bytes.toString('utf8'));
        if (!isRecord(data) || data.version !== 1 || !Array.isArray(data.projects)
          || data.projects.length > PROJECT_LIMITS.recents || !data.projects.every(isReference)) return null;
        return new Set(data.projects.map((record) => record.id)).size === data.projects.length ? data.projects : null;
      });
    } catch (error) {
      return isRecord(error) && error.code === 'ENOENT' ? [] : null;
    }
  }

  async save(projects: RecentReference[]): Promise<boolean> {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    let created = false;
    try {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const handle = await open(temporary, 'wx', 0o600);
      created = true;
      try {
        await handle.writeFile(JSON.stringify({ version: 1, projects }) + '\n', 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.file);
      return true;
    } catch {
      if (created) await rm(temporary, { force: true }).catch(() => undefined);
      return false;
    }
  }
}
