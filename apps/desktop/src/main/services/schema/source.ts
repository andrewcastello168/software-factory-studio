import { opendir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { TextDecoder } from 'node:util';
import { isMigrationName, SCHEMA_LIMITS, STARTER } from '@factory/contracts';
import type { DatabaseSchema, SchemaDiagnostic, SchemaMigration } from '@factory/contracts';
import { sha256 } from '@factory/generator';
import { diagnostic, emptySchema, parseSql, planMigration } from '@factory/schema';
import { directoryIdentity, readBoundedFile, withDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { readProjectMetadata } from '../projects/scan';

const baseline = '0562a84ffce6f622337cd32b38392d21e2f856129f473bc1df8cdb14253a94ac';
const welcome = '1f7f35e721167179b0fbec0b2c7f26a348158cdb788f0332761c84fa68baf81e';
export class SourceUnavailable extends Error {}

export function modelSources(migrations: readonly SchemaMigration[]) {
  let schema: DatabaseSchema = emptySchema();
  let safe = true;
  const diagnostics: SchemaDiagnostic[] = [];
  for (const migration of migrations) {
    const sql = migration.sql.replaceAll('\r\n', '\n');
    const digest = sha256(sql);
    if (migration.name === '0001_baseline.sql' && digest === baseline) continue;
    const knownWelcome = /^000[12]_welcome\.sql$/u.test(migration.name) && digest === welcome;
    const ddl = knownWelcome ? sql.slice(0, sql.indexOf('\nINSERT INTO')) : sql;
    const result = parseSql(ddl, schema, migration.name);
    if (result.diagnostics.length) {
      diagnostics.push(...result.diagnostics);
      break;
    }
    if (!knownWelcome && planMigration(schema, result.schema).sql !== sql) safe = false;
    schema = result.schema;
  }
  return { schema, diagnostics: diagnostics.slice(0, SCHEMA_LIMITS.diagnostics), safe };
}

export async function readSources(root: ProjectRoot) {
  const metadata = await readProjectMetadata(root);
  if (metadata.status !== 'managed' || metadata.descriptor.stackId !== STARTER.stack || metadata.descriptor.profileId !== STARTER.architecture) {
    throw new SourceUnavailable();
  }
  const db = join(root.path, 'db');
  const directory = await withDirectory(root.path, root.identity, async (parent) => {
    const dbIdentity = directoryIdentity(await lstat(join(parent, 'db'), { bigint: true }));
    return withDirectory(db, dbIdentity, async (opened) => ({
      path: join(db, 'migrations'), identity: directoryIdentity(await lstat(join(opened, 'migrations'), { bigint: true })),
    }));
  });
  return withDirectory(directory.path, directory.identity, async (opened) => {
    const paths: string[] = [];
    const diagnostics: SchemaDiagnostic[] = [];
    const stream = await opendir(opened);
    let examined = 0;
    for await (const entry of stream) {
      if (++examined > 1024) throw new SourceUnavailable();
      if (!entry.name.toLowerCase().endsWith('.sql')) continue;
      if (!entry.isFile() || !isMigrationName(entry.name) || paths.length >= SCHEMA_LIMITS.migrations) {
        diagnostics.push(diagnostic('Migration is not a regular file with a supported sequence and name.', 'db/migrations'));
        if (diagnostics.length >= SCHEMA_LIMITS.diagnostics) throw new SourceUnavailable();
      } else paths.push(entry.name);
    }
    paths.sort();
    if (new Set(paths.map((name) => name.slice(0, 4))).size !== paths.length) {
      diagnostics.push(diagnostic('Duplicate migration sequences block this source history.', 'db/migrations'));
    }
    const migrations: SchemaMigration[] = [];
    let total = 0;
    for (const name of paths) {
      const path = join(opened, name);
      try {
        const stat = await lstat(path, { bigint: true });
        const sql = await readBoundedFile(path, stat, SCHEMA_LIMITS.sql, (bytes) => {
          // Decode UTF-8 without stripping a BOM before computing the application's checksum.
          return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
        });
        total += Buffer.byteLength(sql, 'utf8');
        if (sql.includes('\0') || total > 192_000) throw new SourceUnavailable();
        migrations.push({ name, sql, sha256: sha256(sql) });
      } catch {
        diagnostics.push(diagnostic('Migration could not be read safely within the source limits.', name));
        break;
      }
    }
    return { migrations, directory, diagnostics };
  });
}
