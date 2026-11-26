import { randomUUID } from 'node:crypto';
import { json } from 'express';
import type { Router } from 'express';
import type { Pool } from 'pg';
import { actorOf, inputObject, isUuid, issue, listFilter, nameOf, need, PERMISSIONS, sqlConflict, transaction } from './shared.ts';
import type { Audit } from './shared.ts';

export function readPermissions(pool: Pool, user: string) {
  return pool.query<{ permission: string }>('SELECT DISTINCT p.permission FROM factory_identity_user_roles r '
    + 'JOIN factory_identity_role_permissions p ON p.role_id = r.role_id WHERE r.user_id = $1 ORDER BY p.permission', [user])
    .then(({ rows }) => rows.map(({ permission }) => permission));
}
const validPermissions = (value: unknown): value is string[] => Array.isArray(value) && value.length <= PERMISSIONS.length
  && new Set(value).size === value.length && value.every((item: unknown) => typeof item === 'string' && (PERMISSIONS as readonly string[]).includes(item));

export function registerRoles(router: Router, pool: Pool, audit: Audit) {
  // No assignable permission can delegate role, permission or administrator assignment.
  router.use('/roles', need('roles.manage'), json({ limit: '12kb' }));
  router.get('/roles', async (request, response) => {
    const pagination = listFilter(request.query);
    if (!pagination) return issue(response, 400, 'invalid_query', 'Invalid filter or offset.');
    const roles = await pool.query('SELECT r.id, r.name, ARRAY(SELECT p.permission FROM factory_identity_role_permissions p '
      + 'WHERE p.role_id = r.id ORDER BY p.permission) AS permissions FROM factory_identity_roles r '
      + 'WHERE strpos(lower(r.name), lower($1)) > 0 OR $1 = \'\' ORDER BY r.name LIMIT 51 OFFSET $2',
    [pagination.q, pagination.offset]);
    response.json({ data: { rows: roles.rows.slice(0, 50), hasMore: roles.rows.length > 50, permissions: PERMISSIONS } });
  });
  const save = (create: boolean) => async (request: import('express').Request, response: import('express').Response) => {
    const body = inputObject(request.body);
    const id = create ? randomUUID() : request.params.id;
    const name = nameOf(body.name);
    const permissions = body.permissions;
    if (!isUuid(id) || !name || !validPermissions(permissions) || Object.keys(body).some((name) => !['name', 'permissions'].includes(name))) {
      return issue(response, 400, 'invalid_role', 'Provide a name and the supported permissions.');
    }
    try {
      const changed = await transaction(pool, async (client) => {
        const result = await client.query(create ? 'INSERT INTO factory_identity_roles (id, name) VALUES ($1, $2)'
          : 'UPDATE factory_identity_roles SET name = $2 WHERE id = $1', [id, name]);
        if (result.rowCount !== 1) return false;
        if (!create) await client.query('DELETE FROM factory_identity_role_permissions WHERE role_id = $1', [id]);
        await client.query('INSERT INTO factory_identity_role_permissions (role_id, permission) SELECT $1, unnest($2::text[])',
          [id, permissions]);
        await audit(client, create ? 'roles.create' : 'roles.update', actorOf(response)!.id, id);
        return true;
      });
      if (!changed) return issue(response, 404, 'role_missing', 'Role was not found.');
      response.status(create ? 201 : 200).json({ data: { id, name, permissions } });
    } catch (error) {
      if (!sqlConflict(error)) throw error;
      issue(response, 409, 'role_exists', 'A role with that name exists.');
    }
  };
  router.post('/roles', save(true));
  router.patch('/roles/:id', save(false));
  router.get('/roles/assignments/:id', async (request, response) => {
    if (!isUuid(request.params.id)) return issue(response, 400, 'invalid_account', 'Select a valid user.');
    const result = await pool.query<{ role_id: string }>('SELECT role_id FROM factory_identity_user_roles WHERE user_id = $1 ORDER BY role_id',
      [request.params.id]);
    response.json({ data: result.rows.map(({ role_id }) => role_id) });
  });
  router.put('/roles/assignments/:id', async (request, response) => {
    const user = request.params.id;
    const roles = inputObject(request.body).roles;
    if (!isUuid(user) || !Array.isArray(roles) || roles.length > 32 || !roles.every(isUuid) || new Set(roles).size !== roles.length) {
      return issue(response, 400, 'invalid_assignment', 'Select a valid user and roles.');
    }
    try {
      const changed = await transaction(pool, async (client) => {
        const row = await client.query('SELECT id FROM factory_identity_users WHERE id = $1 AND NOT administrator FOR UPDATE', [user]);
        if (!row.rowCount) return false;
        await client.query('DELETE FROM factory_identity_user_roles WHERE user_id = $1', [user]);
        await client.query('INSERT INTO factory_identity_user_roles (user_id, role_id) SELECT $1, unnest($2::uuid[])', [user, roles]);
        await audit(client, 'roles.assign', actorOf(response)!.id, user);
        return true;
      });
      if (!changed) return issue(response, 404, 'account_unavailable', 'This account is unavailable for role assignments.');
      response.json({ data: { updated: true } });
    } catch (error) {
      if (!sqlConflict(error)) throw error;
      issue(response, 400, 'unknown_role', 'A selected role disappeared. Refresh and try again.');
    }
  });
}
