import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { createApi } from './routes.ts';
import { errorHandler, requestLogger } from './middleware.ts';
import type { Log } from './middleware.ts';

export function createApp(pool?: Pool, webRoot?: string, log: Log = () => undefined) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(requestLogger(log));
  app.use('/api', createApi(pool));
  if (webRoot) app.use(express.static(webRoot, { dotfiles: 'deny' }));
  app.use(errorHandler(log));
  return app;
}
