import { randomUUID } from 'node:crypto';
import type { Router } from 'express';
import type { Pool } from 'pg';
import { issue, listFilter, need } from './shared.ts';
import type { Audit } from './shared.ts';

export const recordAudit: Audit = async (database, action, actor, target, resource) => {
  await database.query('INSERT INTO factory_identity_audit (id, actor_id, action, target_id, resource) VALUES ($1, $2, $3, $4, $5)',
    [randomUUID(), actor, action, target, resource ?? action.split('.')[0]]);
};

export function registerAudit(router: Router, pool: Pool) {
  router.get('/audit', need('audit.read'), async (request, response) => {
    const page = listFilter(request.query);
    if (!page) return issue(response, 400, 'invalid_query', 'Invalid filter or offset.');
    const { rows } = await pool.query('SELECT id, actor_id, action, target_id, resource, occurred_at FROM factory_identity_audit '
      + 'WHERE strpos(action, $1) > 0 OR $1 = \'\' ORDER BY occurred_at DESC, id LIMIT 51 OFFSET $2', [page.q, page.offset]);
    response.json({ data: { rows: rows.slice(0, 50), hasMore: rows.length > 50 } });
  });
}
