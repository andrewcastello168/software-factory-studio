import { randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { INCREMENTAL_LIMITS, isGeneratorDigest, isGeneratorPath, isIncrementalHistory, isIncrementalPreview, isRecord } from '@factory/contracts';
import type { IncrementalHistory, IncrementalPreview } from '@factory/contracts';
import { isIncrementalWritePath, sha256 } from '@factory/generator';
import { optionalStat, syncDirectory } from '../generation/journal';
import { admitRoot, readBoundedFile, withDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { isWrite, parents } from './files';
import type { ParentState } from './files';

export interface RecordV1 {
  version: 1;
  context: string;
  revision: string;
  preview: IncrementalPreview;
  directories: ParentState;
}

export function previewDigest(revision: string, preview: Omit<IncrementalPreview, 'digest'>) {
  return sha256(JSON.stringify([revision, preview.backend, preview.frontend, preview.changes.map(({ path, action, before, after }) =>
    [path, action, before === null ? null : sha256(before), after === null ? null : sha256(after)])]));
}

function isPending(x: unknown): x is RecordV1 {
  if (!isRecord(x) || x.version !== 1 || !isGeneratorDigest(x.context) || !isGeneratorDigest(x.revision)
    || !isIncrementalPreview(x.preview) || !isRecord(x.directories)) return false;
  const writes = x.preview.changes.filter(isWrite);
  const expected = parents(writes);
  return x.preview.digest === previewDigest(x.revision, x.preview) && !x.preview.issues.length && writes.length > 0
    && new Set(writes.map(({ path }) => path)).size === writes.length
    && writes.every(({ path, action, before }) => isIncrementalWritePath(path)
      && (action === 'create' ? before === null : before !== null))
    && Object.keys(x.directories).length === expected.length && expected.every((name) => Object.hasOwn(x.directories as object, name))
    && Object.entries(x.directories).every(([path, value]) => isGeneratorPath(path)
      && (value === null || (isRecord(value) && Object.keys(value).length === 3
        && [value.file, value.device, value.created].every((n) => typeof n === 'string' && /^-?\d{1,30}$/u.test(n)))));
}

export class IncrementalStore {
  constructor(private readonly userData: string) {}

  #name(root: ProjectRoot, kind: 'pending' | 'history') {
    return 'incremental-' + kind + '-' + sha256(JSON.stringify(root.identity)) + '.json';
  }

  async #read(root: ProjectRoot, kind: 'pending' | 'history') {
    const storage = await admitRoot(this.userData);
    return withDirectory(storage.path, storage.identity, async (opened) => {
      const path = join(opened, this.#name(root, kind));
      const stat = await optionalStat(path);
      return stat && readBoundedFile(path, stat, INCREMENTAL_LIMITS.journal, (bytes) => JSON.parse(bytes.toString('utf8')) as unknown);
    });
  }

  async #write(root: ProjectRoot, kind: 'pending' | 'history', value: unknown, exclusive: boolean) {
    const storage = await admitRoot(this.userData);
    const content = JSON.stringify(value) + '\n';
    if (Buffer.byteLength(content) > INCREMENTAL_LIMITS.journal) throw new Error('Incremental journal exceeds its size limit.');
    await withDirectory(storage.path, storage.identity, async (opened) => {
      const target = join(opened, this.#name(root, kind));
      const temporary = join(opened, 'factory-incremental-' + randomUUID() + '.tmp');
      const handle = await open(temporary, 'wx', 0o600);
      try {
        try { await handle.writeFile(content, 'utf8'); await handle.sync(); }
        finally { await handle.close(); }
        if (exclusive) await link(temporary, target);
        else {
          const previous = await optionalStat(target);
          if (previous && !previous.isFile()) throw new Error('Incremental journal path is blocked.');
          await rename(temporary, target);
        }
        await syncDirectory(opened);
      } finally { await unlink(temporary).catch(() => undefined); }
    });
  }

  async pending(root: ProjectRoot) {
    const record = await this.#read(root, 'pending');
    if (record === null) return null;
    if (!isPending(record)) throw new Error('Incremental journal is unavailable.');
    return record;
  }

  async save(root: ProjectRoot, record: RecordV1, exclusive = false) {
    if (!isPending(record)) throw new Error('Invalid incremental journal record.');
    await this.#write(root, 'pending', record, exclusive);
  }

  async history(root: ProjectRoot): Promise<IncrementalHistory[]> {
    const stored = await this.#read(root, 'history');
    if (stored === null) return [];
    if (!Array.isArray(stored) || stored.length > INCREMENTAL_LIMITS.history || !stored.every(isIncrementalHistory)) {
      throw new Error('Incremental history is unavailable.');
    }
    return stored;
  }

  async finish(root: ProjectRoot, record: RecordV1, outcome: IncrementalHistory['outcome']) {
    const history = await this.history(root);
    const { id, digest, changes } = record.preview;
    const entry = { id, digest, at: new Date().toISOString(), outcome, files: changes.filter(isWrite).length };
    const next = [entry, ...history.filter((item) => item.id !== id)].slice(0, INCREMENTAL_LIMITS.history);
    await this.#write(root, 'history', next, false);
    const storage = await admitRoot(this.userData);
    await withDirectory(storage.path, storage.identity, async (opened) => {
      const path = join(opened, this.#name(root, 'pending'));
      if (!(await optionalStat(path))?.isFile()) throw new Error('Incremental journal moved.');
      await unlink(path);
      await syncDirectory(opened);
    });
  }
}
