import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hasExactKeys, isQualityEvidence, isRecord, isReleaseEvidence } from '@factory/contracts';
import type { QualityEvidence, ReleaseEvidence } from '@factory/contracts';
import { sha256 } from '@factory/generator';
import { optionalStat, syncDirectory } from '../generation/journal';
import { admitRoot, pathKey, readBoundedFile, withDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';

interface History { version: 1; quality: QualityEvidence[]; releases: ReleaseEvidence[] }

export class DeliveryStore {
  #queue = Promise.resolve();
  constructor(private readonly userData: string) {}

  async #file<T>(root: ProjectRoot, work: (opened: string, target: string, data: History) => Promise<T>) {
    const storage = await admitRoot(this.userData);
    const key = sha256(JSON.stringify([pathKey(root.path), root.identity]));
    return withDirectory(storage.path, storage.identity, async (opened) => {
      const target = join(opened, 'delivery-' + key + '.json');
      const stat = await optionalStat(target);
      const data: unknown = stat ? await readBoundedFile(target, stat, 280_000, (bytes) => JSON.parse(bytes.toString('utf8')) as unknown)
        : { version: 1, quality: [], releases: [] };
      if (!isRecord(data) || !hasExactKeys(data, ['version', 'quality', 'releases']) || data.version !== 1
        || !Array.isArray(data.quality) || data.quality.length > 80 || !data.quality.every(isQualityEvidence)
        || !Array.isArray(data.releases) || data.releases.length > 40 || !data.releases.every(isReleaseEvidence)) {
        throw new Error('Invalid delivery history.');
      }
      return work(opened, target, { version: 1, quality: data.quality, releases: data.releases });
    });
  }

  async read(root: ProjectRoot) {
    await this.#queue;
    return this.#file(root, async (_opened, _target, data) => data);
  }

  #update(root: ProjectRoot, change: (history: History) => void) {
    const task = this.#queue.then(() => this.#file(root, async (opened, target, data) => {
      change(data);
      const stage = join(opened, 'factory-delivery-' + randomUUID() + '.tmp');
      const handle = await open(stage, 'wx', 0o600);
      try {
        try { await handle.writeFile(JSON.stringify(data) + '\n'); await handle.sync(); }
        finally { await handle.close(); }
        await rename(stage, target);
        await syncDirectory(opened);
      } finally { await unlink(stage).catch(() => undefined); }
    }));
    this.#queue = task.then(() => undefined, () => undefined);
    return task;
  }

  quality(root: ProjectRoot, value: QualityEvidence) {
    if (!isQualityEvidence(value)) throw new Error('Invalid verification evidence.');
    return this.#update(root, (data) => { data.quality = [value, ...data.quality.filter(({ id }) => id !== value.id)].slice(0, 80); });
  }

  release(root: ProjectRoot, value: ReleaseEvidence) {
    if (!isReleaseEvidence(value)) throw new Error('Invalid release evidence.');
    return this.#update(root, (data) => {
      if (data.releases.length >= 40 || data.releases.some(({ version }) => version === value.version)) {
        throw new Error('The release version is already recorded or history is full.');
      }
      data.releases.unshift(value);
    });
  }
}
