import pg from 'pg';

export function createPool(connectionString: string) {
  return new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2000,
    statement_timeout: 3000,
    idleTimeoutMillis: 10_000,
  });
}
