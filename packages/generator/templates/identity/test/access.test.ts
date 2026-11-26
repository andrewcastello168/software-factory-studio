import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import type { Pool } from 'pg';
import { createApp } from '../server/app.ts';

test('business and installed management routes deny unauthenticated access and cross-origin writes', async () => {
  const origin = 'http://127.0.0.1:5173';
  const previous = process.env.AUTH_ORIGIN;
  const insecure = process.env.AUTH_ALLOW_INSECURE_LOOPBACK;
  process.env.AUTH_ORIGIN = origin;
  process.env.AUTH_ALLOW_INSECURE_LOOPBACK = '1';
  const pool = { query() { throw new Error('Unauthenticated requests should avoid database reads.'); } } as unknown as Pool;
  const { users, roles, audit } = { users: @@IDENTITYUSERS@@, roles: @@IDENTITYRBAC@@, audit: @@IDENTITYAUDIT@@ };
  const app = createApp(pool);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address === 'object');
    const api = 'http://127.0.0.1:' + address.port + '/api';
    const guarded = ['/auth/session', '/crud/products', ...(users ? ['/users'] : []), ...(roles ? ['/roles'] : []), ...(audit ? ['/audit'] : [])];
    for (const path of guarded) assert.equal((await fetch(api + path)).status, 401, path);
    const crossOrigin = await fetch(api + '/auth/login', { method: 'POST', headers: { Origin: 'https://other.invalid' } });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get('cache-control'), 'no-store');
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
    if (previous === undefined) delete process.env.AUTH_ORIGIN; else process.env.AUTH_ORIGIN = previous;
    if (insecure === undefined) delete process.env.AUTH_ALLOW_INSECURE_LOOPBACK; else process.env.AUTH_ALLOW_INSECURE_LOOPBACK = insecure;
  }
});
