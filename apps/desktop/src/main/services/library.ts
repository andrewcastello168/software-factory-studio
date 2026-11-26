import { canonicalAsset } from '@factory/generator';
import { randomUUID } from 'node:crypto';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { BUILTIN_LIBRARY, failure, isLibraryAssets, isRecord, LIBRARY_LIMIT, success } from '@factory/contracts';
import type { LibraryAsset, Result } from '@factory/contracts';
import { optionalStat, syncDirectory } from './generation/journal';
import { admitRoot, readBoundedFile, withDirectory } from './projects/filesystem';

const libraryByteLimit = 420_000;

export class LibraryStore {
  #queue = Promise.resolve();
  constructor(private readonly userData: string) {}

  async #read(path: string) {
    const stat = await optionalStat(path);
    if (!stat) return [];
    const value = await readBoundedFile(path, stat, libraryByteLimit, (bytes) => JSON.parse(bytes.toString('utf8')) as unknown);
    if (!isRecord(value) || value.version !== 1 || !isLibraryAssets(value.assets)
      || value.assets.some(({ id }) => BUILTIN_LIBRARY.some((asset) => asset.id === id))
      || new Set(value.assets.map(({ id, version }) => id + ':' + version)).size !== value.assets.length) {
      throw new Error('Invalid library storage.');
    }
    return value.assets;
  }

  async #root<T>(work: (directory: string) => Promise<Result<T>>) {
    try {
      const root = await admitRoot(this.userData);
      return await withDirectory(root.path, root.identity, work);
    } catch { return failure('LIBRARY_CONFLICT'); }
  }

  async list(): Promise<Result<LibraryAsset[]>> {
    await this.#queue;
    return this.#root(async (opened) => success([...BUILTIN_LIBRARY, ...await this.#read(join(opened, 'engineering-library.json'))]));
  }

  publish(draft: LibraryAsset): Promise<Result<LibraryAsset>> {
    const result = this.#queue.then(() => this.#root<LibraryAsset>(async (opened) => {
      const destination = join(opened, 'engineering-library.json');
      const assets = await this.#read(destination);
      if (BUILTIN_LIBRARY.some(({ id }) => id === draft.id) || assets.length + BUILTIN_LIBRARY.length >= LIBRARY_LIMIT) {
        return failure('LIBRARY_CONFLICT');
      }
      const versions = assets.filter(({ id }) => id === draft.id);
      const latest = versions.reduce<LibraryAsset | undefined>((best, asset) => !best || asset.version > best.version ? asset : best, undefined);
      if (latest ? latest.kind !== draft.kind || latest.version !== draft.version || latest.version >= 9999 : draft.version !== 1) {
        return failure('LIBRARY_CONFLICT');
      }
      const saved = { ...draft, version: latest ? latest.version + 1 : draft.version };
      if (!await this.#save(opened, destination, [...assets, saved])) return failure('LIBRARY_CONFLICT');
      return success(saved);
    }));
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async #save(opened: string, destination: string, assets: LibraryAsset[]) {
    const content = JSON.stringify({ version: 1, assets }) + '\n';
    if (Buffer.byteLength(content) > libraryByteLimit) return false;
    const temporary = join(opened, 'engineering-library-' + randomUUID() + '.tmp');
    const handle = await open(temporary, 'wx', 0o600);
    try {
      try { await handle.writeFile(content); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, destination);
      await syncDirectory(opened);
    } finally { await unlink(temporary).catch(() => undefined); }
    return true;
  }

  importExact(drafts: LibraryAsset[], authorize: () => Promise<void>): Promise<Result<number>> {
    const task = this.#queue.then(() => this.#root<number>(async (opened) => {
      if (!isLibraryAssets(drafts) || drafts.some(({ id }) => BUILTIN_LIBRARY.some((asset) => asset.id === id))) return failure('LIBRARY_CONFLICT');
      const destination = join(opened, 'engineering-library.json');
      const assets = await this.#read(destination);
      const original = assets.length;
      for (const draft of drafts) {
        const known = assets.find(({ id, version }) => id === draft.id && version === draft.version);
        if (assets.some(({ id, kind }) => id === draft.id && kind !== draft.kind)
          || (known && canonicalAsset(known) !== canonicalAsset(draft))) return failure('LIBRARY_CONFLICT');
        if (!known) assets.push(draft);
      }
      if (assets.length + BUILTIN_LIBRARY.length > LIBRARY_LIMIT) return failure('LIBRARY_CONFLICT');
      await authorize();
      if (assets.length > original && !await this.#save(opened, destination, assets)) return failure('LIBRARY_CONFLICT');
      return success(assets.length - original);
    }));
    this.#queue = task.then(() => undefined, () => undefined);
    return task;
  }

}
