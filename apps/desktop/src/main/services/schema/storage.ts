import { randomUUID } from 'node:crypto';
import { link, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { hasExactKeys, isGeneratorDigest, isMigrationName, isProjectId, isRecord, isSchemaPoints, isSchemaSql } from '@factory/contracts';
import type { SchemaMigration, SchemaPoint } from '@factory/contracts';
import { sha256 } from '@factory/generator';
import { optionalStat, syncDirectory } from '../generation/journal';
import { admitRoot, readBoundedFile, withDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';

export interface MigrationRecord { version: 1; id: string; base: string; migration: SchemaMigration }

function isRecordV1(value: unknown): value is MigrationRecord {
  if (!isRecord(value) || !hasExactKeys(value, ['version', 'id', 'base', 'migration']) || value.version !== 1
    || !isProjectId(value.id) || !isGeneratorDigest(value.base)) return false;
  const { migration } = value;
  return isRecord(migration) && hasExactKeys(migration, ['name', 'sql', 'sha256'])
    && isMigrationName(migration.name) && isSchemaSql(migration.sql) && sha256(migration.sql) === migration.sha256;
}

export class SchemaStore {
  constructor(private readonly directory: string) {}

  #name(root: ProjectRoot, kind: 'layout' | 'journal') {
    return 'schema-' + kind + '-' + sha256(JSON.stringify([root.path, root.identity])) + '.json';
  }

  async #read(root: ProjectRoot, kind: 'layout' | 'journal') {
    const data = await admitRoot(this.directory);
    return withDirectory(data.path, data.identity, async (opened) => {
      const path = join(opened, this.#name(root, kind));
      const stat = await optionalStat(path);
      return stat ? readBoundedFile(path, stat, 110_000, (bytes) => JSON.parse(bytes.toString('utf8')) as unknown) : undefined;
    });
  }

  async #write(root: ProjectRoot, kind: 'layout' | 'journal', value: unknown) {
    const data = await admitRoot(this.directory);
    await withDirectory(data.path, data.identity, async (opened) => {
      const final = join(opened, this.#name(root, kind));
      const temporary = join(opened, 'factory-schema-' + randomUUID() + '.tmp');
      const handle = await open(temporary, 'wx', 0o600);
      try {
        try {
          await handle.writeFile(JSON.stringify(value) + '\n', 'utf8');
          await handle.sync();
        } finally { await handle.close(); }
        if (kind === 'journal') await link(temporary, final);
        else {
          const previous = await optionalStat(final);
          if (previous && !previous.isFile()) throw new Error('Layout path is blocked.');
          await rename(temporary, final);
        }
        await syncDirectory(opened);
      } finally { await unlink(temporary).catch(() => undefined); }
    });
  }

  async layout(root: ProjectRoot) {
    const value = await this.#read(root, 'layout');
    if (value === undefined) return [];
    if (!isRecord(value) || value.version !== 1 || !isSchemaPoints(value.points)) throw new Error('Layout is unreadable.');
    return value.points;
  }

  async saveLayout(root: ProjectRoot, points: SchemaPoint[]) { await this.#write(root, 'layout', { version: 1, points }); }

  async record(root: ProjectRoot) {
    const value = await this.#read(root, 'journal');
    if (value === undefined) return null;
    if (!isRecordV1(value)) throw new Error('Migration journal is unreadable.');
    return value;
  }

  async saveRecord(root: ProjectRoot, value: MigrationRecord) { await this.#write(root, 'journal', value); }

  async finish(root: ProjectRoot) {
    const data = await admitRoot(this.directory);
    await withDirectory(data.path, data.identity, async (opened) => {
      const file = join(opened, this.#name(root, 'journal'));
      const stat = await optionalStat(file);
      if (!stat?.isFile()) throw new Error('Migration journal moved.');
      await unlink(file);
      await syncDirectory(opened);
    });
  }
}
