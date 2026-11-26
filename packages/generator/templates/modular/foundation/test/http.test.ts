import assert from 'node:assert/strict';
import { once } from 'node:events';
import { copyFile, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { createApp } from '../server/app.ts';
import { createPool } from '../server/database.ts';
import { applyMigrations } from '../server/migrations.ts';

async function listen(pool?: Pool) {
  const server = createApp(pool).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected loopback port.');
  return { url: 'http://127.0.0.1:' + address.port, close: () => new Promise<void>((done) => server.close(() => done())) };
}

test('health stays available when PostgreSQL is unconfigured', async () => {
  const app = await listen();
  try {
    const health = await fetch(app.url + '/api/health');
    assert.deepEqual(await health.json(), { data: { status: 'ok' } });
    assert.equal(health.headers.get('x-powered-by'), null);
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(app.url + '/api/ready')).status, 503);
    assert.equal((await fetch(app.url + '/api/missing')).status, 404);
  } finally {
    await app.close();
  }
});

const database = process.env.TEST_DATABASE_URL;
test('real PostgreSQL readiness and recorded migration integrity', { skip: !database }, async () => {
  assert.ok(database);
  const pool = createPool(database);
  const source = resolve('db/migrations');
  const copy = await mkdtemp(join(tmpdir(), 'generated-migrations-'));
  const app = await listen(pool);
  try {
    const ready = await fetch(app.url + '/api/ready');
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { data: { status: 'ready', database: 'postgresql' } });
    await applyMigrations(pool, source);
    assert.equal(await applyMigrations(pool, source), 0);
    for (const file of await readdir(source)) await copyFile(join(source, file), join(copy, file));
    await writeFile(join(copy, '0001_baseline.sql'), 'SELECT 1;');
    await assert.rejects(applyMigrations(pool, copy), /declared history/);
  } finally {
    await app.close();
    await pool.end();
    await rm(copy, { recursive: true, force: true });
  }
});
