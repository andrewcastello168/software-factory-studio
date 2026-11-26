import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/app.ts';
import { createPool } from '../server/database.ts';
import { applyMigrations } from '../server/migrations.ts';
import { createWelcomeRepository } from '../server/repository.ts';
import type { WelcomeRepository } from '../server/repository.ts';

async function listen(repository?: WelcomeRepository) {
  const server = createApp(repository).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback port.');
  return { url: 'http://127.0.0.1:' + address.port, close: () => new Promise<void>((done) => server.close(() => done())) };
}

test('health, request validation and unconfigured database responses', async () => {
  const app = await listen();
  try {
    const health = await fetch(app.url + '/api/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { data: { status: 'ok' } });
    assert.equal(health.headers.get('x-powered-by'), null);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(app.url + '/api/welcome?variant=other')).status, 400);
    assert.equal((await fetch(app.url + '/api/welcome')).status, 503);
    assert.equal((await fetch(app.url + '/api/missing')).status, 404);
  } finally {
    await app.close();
  }
});

const testDatabase = process.env.TEST_DATABASE_URL;
test('PostgreSQL migration ledger and persisted welcome message over HTTP', {
  skip: !testDatabase && 'Set TEST_DATABASE_URL to a dedicated disposable PostgreSQL database.',
}, async () => {
  assert.ok(testDatabase);
  const pool = createPool(testDatabase);
  const migrations = await mkdtemp(join(tmpdir(), 'starter-migrations-'));
  const app = await listen(createWelcomeRepository(pool));
  try {
    const name = '0001_welcome.sql';
    const migration = join(migrations, name);
    await copyFile(resolve('db/migrations', name), migration);
    await applyMigrations(pool, migrations);
    assert.equal(await applyMigrations(pool, migrations), 0);
    const response = await fetch(app.url + '/api/welcome?variant=short');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: { message: 'Ready.' } });
    await writeFile(migration, 'SELECT 1;');
    await assert.rejects(applyMigrations(pool, migrations), /declared history/);
  } finally {
    await app.close();
    await pool.end();
    await rm(migrations, { recursive: true, force: true });
  }
});
