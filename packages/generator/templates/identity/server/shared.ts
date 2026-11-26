import type { NextFunction, Request, Response } from 'express';
import type { Pool, PoolClient } from 'pg';

export interface Actor { id: string; email: string; display_name: string; administrator: boolean; permissions: string[] }
export type PermissionReader = (user: string) => Promise<string[]>;
export type Audit = (database: Pool | PoolClient, action: string, actor: string | null, target: string | null, resource?: string) => Promise<void>;
export const noAudit: Audit = async () => undefined;
export const PERMISSIONS = @@IDENTITYPERMISSIONSLIST@@ as const;
export const emailOf = (value: unknown) => typeof value === 'string' && value.length <= 254
  && /^[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}$/iu.test(value) ? value.toLowerCase() : undefined;
export const nameOf = (value: unknown) => typeof value === 'string' && value.trim().length >= 1
  && value.length <= 100 && !/[\p{Cc}\p{Cf}]/u.test(value) ? value.trim() : undefined;
export const isUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(value);

export function issue(response: Response, status: number, code: string, message: string) {
  response.status(status).json({ error: { code, message } });
}

export const actorOf = (response: Response): Actor | undefined => response.locals.actor as Actor | undefined;

export function need(permission?: string) {
  return (_request: Request, response: Response, next: NextFunction) => {
    const actor = actorOf(response);
    if (!actor) return issue(response, 401, 'authentication_required', 'Sign in to continue.');
    if (permission && !actor.administrator && !actor.permissions.includes(permission)) {
      return issue(response, 403, 'forbidden', 'Your account does not have this permission.');
    }
    next();
  };
}

export async function transaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await work(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally { client.release(); }
}

export function inputObject(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {};
}

export function listFilter(query: Request['query']) {
  const q = query.q ?? '';
  const offset = query.offset ?? '0';
  if (typeof q !== 'string' || q.length > 100 || q.includes('\0') || typeof offset !== 'string'
    || !/^\d{1,5}$/u.test(offset) || Number(offset) > 10_000) return undefined;
  return { q, offset: Number(offset) };
}

export function sqlConflict(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && (error.code === '23505' || error.code === '23503');
}
