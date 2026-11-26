import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

let running = 0;
const cost = { N: 32_768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
export const validPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value) <= 256 && !value.includes('\0');

async function derive(password: string, salt: Buffer) {
  if (running >= 4) throw new Error('Password capacity exceeded.');
  running++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, cost, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { running--; }
}

export async function hashPassword(password: string) {
  if (!validPassword(password)) throw new Error('Password does not meet the length requirements.');
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt-v1', salt.toString('hex'), key.toString('hex')].join('$');
}

export async function verifyPassword(password: string, encoded: string | undefined) {
  const result = /^scrypt-v1\$([0-9a-f]{32})\$([0-9a-f]{128})$/u.exec(encoded ?? '');
  const salt = result ? Buffer.from(result[1]!, 'hex') : Buffer.alloc(16);
  const expected = result ? Buffer.from(result[2]!, 'hex') : Buffer.alloc(64);
  return timingSafeEqual(await derive(password, salt), expected) && Boolean(result);
}
