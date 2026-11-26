import type { Router } from 'express';
import type { Pool } from 'pg';
import { tables } from './contracts.ts';
import { controller } from './controller.ts';

export function registerCrud(router: Router, pool?: Pool) {
  for (const table of tables) {
    const path = '/crud/' + table.name;
    if (pool) router.use(path, controller(pool, table));
    else router.use(path, (_request, response) => {
      response.status(503).json({ error: { code: 'database_unavailable', message: 'PostgreSQL is unavailable.' } });
    });
  }
}
