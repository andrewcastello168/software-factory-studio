import express from 'express';
import helmet from 'helmet';
import { createApi } from './routes.ts';
import { errorHandler, requestLogger } from './middleware.ts';
import type { Log } from './middleware.ts';
import type { WelcomeRepository } from './repository.ts';

export function createApp(repository?: WelcomeRepository, webRoot?: string, log: Log = () => undefined) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: null } } }));
  app.use(requestLogger(log));
  app.use('/api', createApi(repository));
  if (webRoot) app.use(express.static(webRoot, { dotfiles: 'deny' }));
  app.use(errorHandler(log));
  return app;
}
