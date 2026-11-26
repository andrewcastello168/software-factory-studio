import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { readConfig } from './config.ts';
import { createPool } from './database.ts';
import { createWelcomeRepository } from './repository.ts';

const config = readConfig();
const log = (entry: Record<string, string | number>) => console.info(JSON.stringify(entry));
const pool = config.databaseUrl ? createPool(config.databaseUrl) : undefined;
pool?.on('error', () => log({ event: 'database_idle_connection_error' }));
const server = createApp(pool ? createWelcomeRepository(pool) : undefined, resolve('dist/web'), log)
  .listen(config.port, config.host, () => log({ event: 'listening', port: config.port }));

function shutdown() {
  server.close(() => { void pool?.end(); });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
