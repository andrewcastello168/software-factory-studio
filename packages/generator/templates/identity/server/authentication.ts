import { createHash, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { TLSSocket } from 'node:tls';
import { json } from 'express';
import type { Request, Router, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { validPassword, verifyPassword } from './password.ts';
import { actorOf, emailOf, inputObject, issue, need, transaction } from './shared.ts';
import type { Actor, Audit, PermissionReader } from './shared.ts';

const sessionHours = 8;
const loopback = (address: string | undefined) => address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function originPolicy() {
  try {
    const origin = new URL(process.env.AUTH_ORIGIN ?? '');
    if (origin.origin !== process.env.AUTH_ORIGIN || origin.username || origin.password) return undefined;
    if (origin.protocol === 'https:') return { origin, secure: true, cookie: '__Host-factory_session' };
    if (origin.protocol === 'http:' && process.env.AUTH_ALLOW_INSECURE_LOOPBACK === '1'
      && ['127.0.0.1', '[::1]'].includes(origin.hostname)) return { origin, secure: false, cookie: 'factory_local_session' };
  } catch { /* Fail closed for invalid configuration. */ }
  return undefined;
}

function token(request: Request, cookie: string) {
  const matches = (request.headers.cookie ?? '').split(';').map((part) => part.trim())
    .filter((part) => part.startsWith(cookie + '='));
  const value = matches.length === 1 ? matches[0]?.slice(cookie.length + 1) : undefined;
  return value && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
}

export function registerAuthentication(router: Router, pool: Pool | undefined, permissions: PermissionReader, audit: Audit, enforcePermissions: boolean) {
  const policy = originPolicy();
  const cookieOptions = { httpOnly: true, secure: policy?.secure ?? true, sameSite: 'strict' as const, path: '/' };
  const ready: RequestHandler = (request, response, next) => {
    response.set('Cache-Control', 'no-store');
    const local = loopback(request.socket.remoteAddress);
    const https = request.socket instanceof TLSSocket || (local && request.get('X-Forwarded-Proto') === 'https');
    if (!pool || !policy || (policy.secure ? !https : !local || request.hostname !== policy.origin.hostname)) {
      return issue(response, 503, 'identity_unavailable', 'Authentication is unavailable.');
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.get('Origin') !== policy.origin.origin) {
      return issue(response, 403, 'invalid_origin', 'Use the configured application origin.');
    }
    next();
  };

  const authenticate: RequestHandler = async (request, response, next) => {
    const raw = policy && token(request, policy.cookie);
    if (!pool || !raw) return next();
    const result = await pool.query<Omit<Actor, 'permissions'>>(
      'SELECT u.id, u.email, u.display_name, u.administrator FROM factory_identity_sessions s '
      + 'JOIN factory_identity_users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.active',
      [hash(raw)],
    );
    const found = result.rows[0];
    if (found) response.locals.actor = { ...found, permissions: await permissions(found.id) };
    next();
  };

  router.use(['/auth', '/users', '/roles', '/audit', '/crud', '/welcome'], ready, authenticate);
  router.get('/auth/session', need(), (_request, response) => response.json({ data: actorOf(response) }));
  router.post('/auth/login', json({ limit: '8kb' }), async (request, response) => {
    if (!pool || !policy) return issue(response, 503, 'identity_unavailable', 'Authentication is unavailable.');
    const input = inputObject(request.body);
    const email = emailOf(input.email);
    const password = input.password;
    if (!email || !validPassword(password)) return issue(response, 400, 'invalid_input', 'Provide a valid email and password.');
    const forwarded = request.get('X-Forwarded-For');
    const peer = policy.secure && loopback(request.socket.remoteAddress) && forwarded && isIP(forwarded)
      ? forwarded : request.socket.remoteAddress;
    const ipBucket = hash('ip:' + (peer ?? 'unknown'));
    const emailBucket = hash('account:' + email);
    const rate = await pool.query<{ bucket: string; attempts: number }>(
      "INSERT INTO factory_identity_attempts (bucket, attempts, resets_at) VALUES ($1, 1, NOW() + INTERVAL '15 minutes'), ($2, 1, NOW() + INTERVAL '15 minutes') "
      + 'ON CONFLICT (bucket) DO UPDATE SET attempts = CASE WHEN factory_identity_attempts.resets_at <= NOW() THEN 1 '
      + "ELSE LEAST(factory_identity_attempts.attempts + 1, 1000) END, resets_at = CASE WHEN factory_identity_attempts.resets_at <= NOW() "
      + "THEN NOW() + INTERVAL '15 minutes' ELSE factory_identity_attempts.resets_at END RETURNING bucket, attempts", [ipBucket, emailBucket],
    );
    if (rate.rows.some(({ bucket, attempts }) => attempts > (bucket === emailBucket ? 8 : 40))) {
      response.set('Retry-After', '900');
      return issue(response, 429, 'try_later', 'Too many sign-in attempts. Try again later.');
    }
    const account = (await pool.query<{ id: string; password_hash: string; active: boolean }>(
      'SELECT id, password_hash, active FROM factory_identity_users WHERE email = $1', [email],
    )).rows[0];
    const verified = await verifyPassword(password, account?.password_hash);
    if (!verified || !account?.active) {
      await audit(pool, 'auth.login_failed', null, null);
      return issue(response, 401, 'invalid_credentials', 'Email or password is incorrect.');
    }
    const secret = randomBytes(32).toString('hex');
    const old = token(request, policy.cookie);
    const created = await transaction(pool, async (client) => {
      const current = await client.query('SELECT id FROM factory_identity_users WHERE id = $1 AND password_hash = $2 AND active FOR SHARE',
        [account.id, account.password_hash]);
      if (current.rowCount !== 1) return false;
      await client.query("INSERT INTO factory_identity_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '8 hours')",
        [hash(secret), account.id]);
      if (old) await client.query('DELETE FROM factory_identity_sessions WHERE token_hash = $1', [hash(old)]);
      await client.query('DELETE FROM factory_identity_attempts WHERE bucket = $1', [emailBucket]);
      await audit(client, 'auth.login', account.id, account.id);
      return true;
    });
    if (!created) return issue(response, 401, 'invalid_credentials', 'Email or password is incorrect.');
    response.cookie(policy.cookie, secret, { ...cookieOptions, maxAge: sessionHours * 60 * 60 * 1000 });
    response.json({ data: { signedIn: true } });
  });
  router.post('/auth/logout', async (request, response) => {
    if (!pool || !policy) return issue(response, 503, 'identity_unavailable', 'Authentication is unavailable.');
    const raw = token(request, policy.cookie);
    const actor = actorOf(response);
    if (raw) await transaction(pool, async (client) => {
      await client.query('DELETE FROM factory_identity_sessions WHERE token_hash = $1', [hash(raw)]);
      if (actor) await audit(client, 'auth.logout', actor.id, actor.id);
    });
    response.clearCookie(policy.cookie, cookieOptions);
    response.json({ data: { signedIn: false } });
  });

  router.use('/welcome', need());
  router.use('/crud', (request, response, next) => {
    const read = ['GET', 'HEAD'].includes(request.method);
    need(enforcePermissions ? (read ? 'crud.read' : 'crud.write') : undefined)(request, response, () => {
      if (!read && pool) {
        const events: Record<string, string> = { POST: 'crud.create', PATCH: 'crud.update', DELETE: 'crud.delete' };
        const action = events[request.method];
        const resource = /^\/([a-z][a-z0-9_]{0,62})(?:\/record)?$/u.exec(request.path)?.[1];
        if (action && resource) response.once('finish', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            void audit(pool, action, actorOf(response)?.id ?? null, null, resource).catch(() => undefined);
          }
        });
      }
      next();
    });
  });
}
