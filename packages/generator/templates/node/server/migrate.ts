import { resolve } from 'node:path';
import { readConfig } from './config.ts';
import { createPool } from './database.ts';
import { applyMigrations } from './migrations.ts';

const { databaseUrl } = readConfig();
if (!databaseUrl) throw new Error('Set DATABASE_URL to the approved target before migrating.');
const pool = createPool(databaseUrl);
try {
  const applied = await applyMigrations(pool, resolve('db/migrations'));
  console.info('Migrations applied: ' + applied);
} catch {
  console.error('Migration failed. Check the database connection and ordered migration history.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
