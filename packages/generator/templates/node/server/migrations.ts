import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

export async function applyMigrations(pool: Pool, directory: string) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.name.endsWith('.sql'));
  if (!files.length || files.some((file) => !file.isFile() || !/^\d{4}_[a-z0-9_]+\.sql$/u.test(file.name))) {
    throw new Error('Invalid SQL migration directory.');
  }
  const ordered = files.map((file) => file.name).sort();
  if (new Set(ordered.map((name) => name.slice(0, 4))).size !== ordered.length) {
    throw new Error('Duplicate SQL migration sequence.');
  }
  const migrations = await Promise.all(ordered.map(async (name) => {
    const sql = await readFile(join(directory, name), 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql, 'utf8').digest('hex') };
  }));
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query("SET LOCAL lock_timeout = '5s'");
    await connection.query('SELECT pg_advisory_xact_lock(60543121)');
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL)');
    const { rows } = await connection.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations ORDER BY name');
    for (const [index, applied] of rows.entries()) {
      const declared = migrations[index];
      if (!declared || declared.name !== applied.name || declared.checksum !== applied.checksum) {
        throw new Error('Applied migrations do not match the declared history.');
      }
    }
    for (const migration of migrations.slice(rows.length)) {
      await connection.query(migration.sql);
      await connection.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
    }
    await connection.query('COMMIT');
    return migrations.length - rows.length;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    connection.release();
  }
}
