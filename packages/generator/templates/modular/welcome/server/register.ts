import type { Router } from 'express';
import type { Pool } from 'pg';
import { welcomeController } from './controller.ts';
import { createWelcomeRepository } from './repository.ts';

export function registerWelcome(router: Router, pool?: Pool) {
  router.get('/welcome', welcomeController(pool ? createWelcomeRepository(pool) : undefined));
}
