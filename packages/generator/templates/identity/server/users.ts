import { randomUUID } from 'node:crypto';
import { json } from 'express';
import type { Router } from 'express';
import type { Pool } from 'pg';
import { hashPassword, validPassword } from './password.ts';
import { actorOf, emailOf, inputObject, isUuid, issue, listFilter, nameOf, need, sqlConflict, transaction } from './shared.ts';
import type { Audit } from './shared.ts';

const columns = 'id, email, display_name, active, administrator';
interface Account { id: string; email: string; display_name: string; active: boolean; administrator: boolean }

export function registerUsers(router: Router, pool: Pool, audit: Audit) {
  router.use('/users', need('users.manage'), json({ limit: '12kb' }));
  router.get('/users', async (request, response) => {
    const pagination = listFilter(request.query);
    if (!pagination) return issue(response, 400, 'invalid_query', 'Invalid filter or offset.');
    const rows = (await pool.query<Account>('SELECT ' + columns + ' FROM factory_identity_users '
      + 'WHERE strpos(lower(email || display_name), lower($1)) > 0 OR $1 = \'\' ORDER BY email LIMIT 51 OFFSET $2',
    [pagination.q, pagination.offset])).rows;
    response.json({ data: { rows: rows.slice(0, 50), hasMore: rows.length > 50 } });
  });
  router.post('/users', need('users.write'), async (request, response) => {
    const input = inputObject(request.body);
    const email = emailOf(input.email);
    const name = nameOf(input.displayName);
    const password = input.password;
    if (!email || !name || !validPassword(password) || Object.keys(input).some((key) => !['email', 'displayName', 'password'].includes(key))) {
      return issue(response, 400, 'invalid_account', 'Provide email, display name and a valid initial password.');
    }
    const encoded = await hashPassword(password);
    const id = randomUUID();
    try {
      const account = await transaction(pool, async (client) => {
        const row = (await client.query<Account>('INSERT INTO factory_identity_users (id, email, display_name, password_hash) '
          + 'VALUES ($1, $2, $3, $4) RETURNING ' + columns, [id, email, name, encoded])).rows[0];
        await audit(client, 'users.create', actorOf(response)!.id, id);
        return row;
      });
      response.status(201).json({ data: account });
    } catch (error) {
      if (!sqlConflict(error)) throw error;
      issue(response, 409, 'account_exists', 'An account with this email exists.');
    }
  });
  router.patch('/users/:id', need('users.write'), async (request, response) => {
    const id = request.params.id;
    const input = inputObject(request.body);
    const name = input.displayName === undefined ? null : nameOf(input.displayName);
    const active = input.active === undefined ? null : input.active;
    const password = input.password;
    if (!isUuid(id) || name === undefined || (active !== null && typeof active !== 'boolean')
      || (password !== undefined && !validPassword(password)) || !Object.keys(input).length
      || Object.keys(input).some((key) => !['displayName', 'active', 'password'].includes(key))) {
      return issue(response, 400, 'invalid_account', 'Provide valid account changes.');
    }
    const encoded = password === undefined ? null : await hashPassword(password);
    const account = await transaction(pool, async (client) => {
      const row = (await client.query<Account>('UPDATE factory_identity_users SET display_name = COALESCE($2, display_name), '
        + 'active = COALESCE($3, active), password_hash = COALESCE($4, password_hash) WHERE id = $1 AND NOT administrator '
        + 'RETURNING ' + columns, [id, name, active, encoded])).rows[0];
      if (!row) return undefined;
      if (active === false || encoded) await client.query('DELETE FROM factory_identity_sessions WHERE user_id = $1', [id]);
      await audit(client, encoded ? 'users.password_rotated' : 'users.update', actorOf(response)!.id, id);
      return row;
    });
    if (!account) return issue(response, 404, 'account_unavailable', 'This account is unavailable for managed edits.');
    response.json({ data: account });
  });
}
