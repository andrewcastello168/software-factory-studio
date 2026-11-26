import { Router } from 'express';
import type { Pool } from 'pg';
@@APIIMPORTS@@
export function createApi(pool?: Pool) {
  const router = Router();
  router.get('/health', (_request, response) => response.json({ data: { status: 'ok' } }));
  router.get('/ready', async (_request, response) => {
    try {
      if (!pool) throw new Error('Database is unconfigured.');
      await pool.query('SELECT 1');
      response.json({ data: { status: 'ready', database: 'postgresql' } });
    } catch {
      response.status(503).json({ error: { code: 'database_unavailable', message: 'PostgreSQL is unavailable.' } });
    }
  });
@@APIROUTES@@  router.use((_request, response) => {
    response.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } });
  });
  return router;
}
