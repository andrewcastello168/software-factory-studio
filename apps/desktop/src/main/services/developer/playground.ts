import { request, validateHeaderName, validateHeaderValue } from 'node:http';
import type { PlaygroundRequest, PlaygroundResponse, HttpPair } from '@factory/contracts';

function secretLabel(name: string) {
  return /password|secret|token|authorization|cookie|credential|database_url|api.?key|session|private.?key/iu.test(name);
}

export function redact(text: string, values: string[]): string {
  if (/\b(?:postgres(?:ql)?:\/\/|Bearer\s+|(?:password|secret|token|authorization|cookie|credential|api.?key)\s*["']?\s*[:=])/iu.test(text)) {
    return '[Redacted sensitive output]';
  }
  const trimmed = text.slice(0, 128_000);
  return [...new Set(values)].reduce((result, value) => value ? result.replaceAll(value, '[redacted]').slice(0, 128_000) : result, trimmed);
}

export const sensitiveKey = secretLabel;

export function requestSecrets(input: PlaygroundRequest) {
  const result = input.query.filter(([name]) => sensitiveKey(name)).map(([, value]) => value);
  for (const [header, value] of input.headers) {
    if (!sensitiveKey(header)) continue;
    result.push(value);
    if (header.toLowerCase() === 'authorization') result.push(value.slice(value.indexOf(' ') + 1));
    if (header.toLowerCase() === 'cookie') for (const cookie of value.split(';')) result.push(cookie.slice(cookie.indexOf('=') + 1).trim());
  }
  if (input.body) {
    const pending: unknown[] = [JSON.parse(input.body) as unknown];
    for (let i = 0; i < 150 && pending.length && result.length < 80; i++) {
      const node = pending.pop();
      if (typeof node !== 'object' || node === null) continue;
      for (const [key, value] of Object.entries(node)) {
        if (sensitiveKey(key) && typeof value === 'string' && value) result.push(value);
        else if (typeof value === 'object' && value !== null) pending.push(value);
      }
    }
  }
  return result.filter(Boolean).slice(0, 80);
}
const invalidHeaderByte = new RegExp('[' + String.fromCharCode(0) + '-' + String.fromCharCode(31, 127) + ']', 'gu');

export function prepareRequest(input: PlaygroundRequest) {
  const query = new URLSearchParams(input.query).toString();
  const path = input.path + (query ? '?' + query : '');
  if (path.length > 4096 || (input.body && ['GET', 'HEAD', 'OPTIONS'].includes(input.method))) throw new Error('Invalid HTTP request.');
  if (input.body) JSON.parse(input.body);
  if (Buffer.byteLength(input.body) > 64_000) throw new Error('Invalid HTTP request.');
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [original, value] of input.headers) {
    const name = original.toLowerCase();
    validateHeaderName(name);
    validateHeaderValue(name, value);
    if (Object.hasOwn(headers, name) || !/^(accept|authorization|cookie|origin|if-match|if-none-match|x-[a-z0-9-]+)$/u.test(name)
      || /^x-(?:forwarded|real-ip|original|rewrite|http-method|host|remote)/u.test(name)) throw new Error('Unsupported HTTP header.');
    headers[name] = value;
  }
  if (input.body) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = String(Buffer.byteLength(input.body));
  }
  if (JSON.stringify(headers).length > 8192) throw new Error('Request headers exceed the limit.');
  return { path, headers };
}

export function sendRequest(input: PlaygroundRequest, port: number, prepared: ReturnType<typeof prepareRequest>, secrets: string[]) {
  return new Promise<PlaygroundResponse>((resolve, reject) => {
    const start = performance.now();
    const req = request({
      hostname: '127.0.0.1', family: 4, port, method: input.method,
      path: prepared.path, headers: prepared.headers, agent: false, maxHeaderSize: 8192,
      signal: AbortSignal.timeout(8000),
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.byteLength;
        if (size > 128_000) req.destroy(new Error('Response exceeds 128 KB.'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => {
        const headers: HttpPair[] = [];
        for (const [name, value] of Object.entries(res.headers)) {
          if (headers.length === 60) break;
          if (value !== undefined) headers.push([name, secretLabel(name) ? '[redacted]' : redact(String(value), secrets).replace(invalidHeaderByte, ' ').slice(0, 4096)]);
        }
        const type = String(res.headers['content-type'] ?? '');
        const text = /^(?:text\/|application\/(?:[\w.+-]*\+)?json)/iu.test(type);
        const location = res.statusCode && res.statusCode >= 300 && res.statusCode < 400;
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode ?? 500, headers, duration: Math.round(performance.now() - start),
          body: !body ? '' : location ? 'Redirect response. Studio did not follow the redirect.'
            : text ? redact(body, secrets).replaceAll('\0', '�').slice(0, 131072) : '[Non-text response omitted]',
        });
      });
    });
    req.on('error', reject);
    req.end(input.body || undefined);
  });
}
