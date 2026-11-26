import assert from 'node:assert/strict';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { createApp } from '../server/app.ts';
import { createPool } from '../server/database.ts';
import { applyMigrations } from '../server/migrations.ts';

test('welcome validates requests and reads the optional seeded record', async () => {
  const database = process.env.TEST_DATABASE_URL;
  const pool = database ? createPool(database) : undefined;
  const server = createApp(pool).listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const url = 'http://127.0.0.1:' + address.port + '/api/welcome';
    assert.equal((await fetch(url + '?variant=unknown')).status, 400);
    if (pool) {
      await applyMigrations(pool, resolve('db/migrations'));
      const response = await fetch(url + '?variant=short');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { data: { message: 'Ready.' } });
    } else {
      assert.equal((await fetch(url)).status, 503);
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    await pool?.end();
  }
});
