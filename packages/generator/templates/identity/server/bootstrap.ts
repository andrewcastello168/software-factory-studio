import { randomUUID } from 'node:crypto';
import { createPool } from '../../database.ts';
import { hashPassword, validPassword } from './password.ts';
import { emailOf, transaction } from './shared.ts';

async function provision() {
  const email = emailOf(process.env.AUTH_BOOTSTRAP_EMAIL);
  const database = process.env.DATABASE_URL;
  if (!email || !database || process.stdin.isTTY) throw new Error('Provide DATABASE_URL, AUTH_BOOTSTRAP_EMAIL and a password through stdin.');
  const input: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += bytes.length;
    if (size > 258) throw new Error('Password input is too large.');
    input.push(bytes);
  }
  const password = Buffer.concat(input).toString('utf8').replace(/\r?\n$/u, '');
  if (!validPassword(password)) throw new Error('Use a password of at least 12 characters and at most 256 UTF-8 bytes.');
  const encoded = await hashPassword(password);
  const pool = createPool(database);
  try {
    const created = await transaction(pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(60543122)');
      const existing = await client.query('SELECT id FROM factory_identity_users WHERE administrator LIMIT 1');
      if (existing.rowCount) return false;
      await client.query(
        'INSERT INTO factory_identity_users (id, email, display_name, password_hash, administrator) VALUES ($1, $2, $3, $4, TRUE)',
        [randomUUID(), email, 'Administrator', encoded],
      );
      return true;
    });
    if (!created) throw new Error('An administrator has already been provisioned.');
    console.info('Administrator provisioned.');
  } finally { await pool.end(); }
}

provision().catch(() => {
  console.error('Administrator provisioning failed. Check database migrations and environment settings.');
  process.exitCode = 1;
});
