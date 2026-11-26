import express from 'express';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { Table } from './contracts.ts';
import { service } from './service.ts';
import { InvalidInput } from './validation.ts';

const error = (code: string, message: string) => ({ error: { code, message } });
const notFound = () => error('not_found', 'Record not found.');
const mutationTypes: RequestHandler = (request, response, next) => {
  if ((request.method === 'POST' || request.method === 'PATCH') && !request.is('application/json')) {
    response.status(415).json(error('invalid_content_type', 'Send an application/json request.'));
    return;
  }
  next();
};

const handleError: ErrorRequestHandler = (cause: unknown, _request, response, next) => {
  const code = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  const status = cause && typeof cause === 'object' && 'status' in cause ? cause.status : undefined;
  if (cause instanceof InvalidInput) response.status(400).json(error('invalid_request', cause.message));
  else if (status === 400 || status === 413) response.status(status).json(error('invalid_body', 'The request body is invalid or too large.'));
  else if (code === '23503' || code === '23505' || code === '23514' || code === '23502') {
    response.status(409).json(error('constraint_violation', 'The operation conflicts with a database constraint.'));
  } else if (code === '22P02' || code === '22003' || code === '22007' || code === '22008') {
    response.status(400).json(error('invalid_request', 'The database could not accept one of the supplied values.'));
  } else next(cause);
};

export function controller(pool: Pool, table: Table) {
  const records = service(pool, table);
  const router = express.Router();
  router.use(mutationTypes, express.json({ limit: '32kb', strict: true }));
  router.get('/', async (request, response) => response.json({ data: await records.list(request.query) }));
  router.post('/', async (request, response) => response.status(201).json({ data: await records.create(request.body) }));
  router.get('/record', async (request, response) => {
    const data = await records.get(request.query.id);
    return data ? response.json({ data }) : response.status(404).json(notFound());
  });
  router.patch('/record', async (request, response) => {
    const data = await records.update(request.query.id, request.body);
    return data ? response.json({ data }) : response.status(404).json(notFound());
  });
  router.delete('/record', async (request, response) => {
    return await records.remove(request.query.id)
      ? response.json({ data: { deleted: true } }) : response.status(404).json(notFound());
  });
  router.use(handleError);
  return router;
}
