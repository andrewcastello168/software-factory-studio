import { Router } from 'express';
import { welcomeController } from './controller.ts';
import type { WelcomeRepository } from './repository.ts';

export function createApi(repository?: WelcomeRepository) {
  const router = Router();
  router.get('/health', (_request, response) => response.json({ data: { status: 'ok' } }));
  router.get('/welcome', welcomeController(repository));
  router.use((_request, response) => {
    response.status(404).json({ error: { code: 'not_found', message: 'Endpoint not found.' } });
  });
  return router;
}
