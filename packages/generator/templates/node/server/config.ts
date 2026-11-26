export function readConfig(env = process.env) {
  const port = Number(env.PORT ?? @@PORT@@);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT is invalid.');
  const host = env.HOST ?? '127.0.0.1';
  if (!host || /[\s/]/u.test(host)) throw new Error('HOST is invalid.');
  const databaseUrl = env.DATABASE_URL || undefined;
  if (databaseUrl) {
    let protocol: string;
    try {
      protocol = new URL(databaseUrl).protocol;
    } catch {
      throw new Error('DATABASE_URL is invalid.');
    }
    if (protocol !== 'postgres:' && protocol !== 'postgresql:') throw new Error('DATABASE_URL must use PostgreSQL.');
  }
  return { port, host, databaseUrl };
}
