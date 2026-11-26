import type { RequestHandler } from 'express';
import type { WelcomeRepository } from './repository.ts';
import { readWelcome } from './service.ts';

export function welcomeController(repository?: WelcomeRepository): RequestHandler {
  return async (request, response, next) => {
    const variant = request.query.variant ?? 'default';
    if (variant !== 'default' && variant !== 'short') {
      response.status(400).json({ error: { code: 'invalid_variant', message: 'Use default or short.' } });
      return;
    }
    if (!repository) {
      response.status(503).json({ error: { code: 'database_unconfigured', message: 'Configure PostgreSQL first.' } });
      return;
    }
    try {
      const message = await readWelcome(repository, variant);
      if (message === undefined) {
        response.status(404).json({ error: { code: 'welcome_missing', message: 'The requested message was not found.' } });
        return;
      }
      response.json({ data: { message } });
    } catch (error) {
      next(error);
    }
  };
}
