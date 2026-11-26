import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../server/features/identity/password.ts';

test('passwords use different salts and reject invalid or mismatched hashes', async () => {
  const value = 'temporary fixture password';
  const first = await hashPassword(value);
  const second = await hashPassword(value);
  assert.notEqual(first, second);
  assert.ok(!first.includes(value));
  assert.equal(await verifyPassword(value, first), true);
  assert.equal(await verifyPassword('different fixture password', second), false);
  assert.equal(await verifyPassword(value, 'unknown-format'), false);
});
