import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defaultPreferences, failure, hasExactKeys, isPreferences, isRecord, success } from '@factory/contracts';
import type { PreferenceSnapshot, Preferences, PreferenceWrite, Result } from '@factory/contracts';

const VERSION = 1;
const MAX_BYTES = 4096;
type StoredPreferences = Omit<PreferenceSnapshot, 'systemTheme'>;

function defaults(storage: StoredPreferences['storage']): StoredPreferences {
  return { preferences: { ...defaultPreferences }, storage };
}

function decode(text: string): StoredPreferences {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return defaults('corrupt');
  }
  if (isRecord(value) && typeof value.version === 'number' && value.version > VERSION) {
    return defaults('unsupported');
  }
  if (isRecord(value) && hasExactKeys(value, ['version', 'preferences'])
    && value.version === VERSION && isPreferences(value.preferences)) {
    return { preferences: value.preferences, storage: 'ready' };
  }
  return defaults('corrupt');
}

export class PreferenceStore {
  #pending: Promise<unknown> = Promise.resolve();

  constructor(private readonly file: string) {}

  #queue<T>(job: () => Promise<T>): Promise<T> {
    const next = this.#pending.then(job);
    this.#pending = next.catch(() => undefined);
    return next;
  }

  async #read(): Promise<Result<StoredPreferences>> {
    try {
      const info = await lstat(this.file, { bigint: true });
      if (!info.isFile()) return failure('PREFERENCES_READ_FAILED');
      if (info.size > MAX_BYTES) return failure('PREFERENCES_READ_FAILED');
      const handle = await open(this.file, 'r');
      try {
        const opened = await handle.stat({ bigint: true });
        // Windows may omit the volume serial in path-based stats. Require the
        // same creation time as well as the full file ID in that case.
        const sameVolume = opened.dev === info.dev;
        const sameCreationWithUnknownVolume = process.platform === 'win32' && info.dev === 0n
          && opened.birthtimeNs === info.birthtimeNs;
        if (!opened.isFile() || opened.ino !== info.ino || (!sameVolume && !sameCreationWithUnknownVolume)) {
          return failure('PREFERENCES_READ_FAILED');
        }
        const buffer = Buffer.alloc(MAX_BYTES + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return bytesRead > MAX_BYTES ? failure('PREFERENCES_READ_FAILED')
          : success(decode(buffer.toString('utf8', 0, bytesRead)));
      } finally {
        await handle.close();
      }
    } catch (error) {
      return isRecord(error) && error.code === 'ENOENT'
        ? success(defaults('ready')) : failure('PREFERENCES_READ_FAILED');
    }
  }

  read(): Promise<Result<StoredPreferences>> {
    return this.#queue(() => this.#read());
  }

  write(request: PreferenceWrite): Promise<Result<Preferences>> {
    return this.#queue(async () => {
      const current = await this.#read();
      if (!current.ok) return current;
      const { storage, preferences } = current.value;
      const authorized = request.action === 'restoreDefaults' ? storage === 'corrupt' : storage === 'ready';
      if (!authorized) return failure('PREFERENCES_REVIEW_REQUIRED');
      const next = request.action === 'restoreDefaults'
        ? { ...defaultPreferences } : { ...preferences, ...request.changes };
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      let created = false;
      try {
        await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
        const handle = await open(temporary, 'wx', 0o600);
        created = true;
        try {
          await handle.writeFile(JSON.stringify({ version: VERSION, preferences: next }) + '\n', 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporary, this.file);
        return success(next);
      } catch {
        if (created) await rm(temporary, { force: true }).catch(() => undefined);
        return failure('PREFERENCES_WRITE_FAILED');
      }
    });
  }
}
