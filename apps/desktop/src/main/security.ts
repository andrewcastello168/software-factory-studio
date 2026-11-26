import addresses from '../../addresses.json' with { type: 'json' };

export const rendererRestrictions = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  webviewTag: false,
  webSecurity: true,
} as const;

export const APP_URL = 'studio://app/';
export const DEV_URL = `${addresses.desktop}/`;
export const PRODUCTION_CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "object-src 'none'",
  "base-uri 'none'", "frame-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
  "connect-src 'none'",
].join('; ');

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function hasAuthority(url: URL, expected: URL): boolean {
  return url.protocol === expected.protocol && url.host === expected.host
    && !url.username && !url.password;
}

export function isRendererDocument(url: string, development: boolean): boolean {
  const parsed = parse(url);
  return parsed !== null && hasAuthority(parsed, new URL(development ? DEV_URL : APP_URL))
    && parsed.pathname === '/' && !parsed.search && !parsed.hash;
}

const mediaTypes: Readonly<Record<string, string>> = {
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  woff2: 'font/woff2',
};

export function resolveBundledRoute(url: string): { relativePath: string; mediaType: string } | null {
  const parsed = parse(url);
  if (!parsed || !hasAuthority(parsed, new URL(APP_URL)) || parsed.search || parsed.hash) return null;
  if (parsed.pathname === '/') return { relativePath: 'index.html', mediaType: 'text/html; charset=utf-8' };
  const asset = /^\/assets\/[a-z\d_-]+\.([a-z0-9]+)$/i.exec(parsed.pathname);
  const extension = asset?.[1];
  if (!extension || !Object.hasOwn(mediaTypes, extension)) return null;
  const mediaType = mediaTypes[extension];
  return mediaType ? { relativePath: parsed.pathname.slice(1), mediaType } : null;
}

interface FrameIdentity {
  processId: number;
  routingId: number;
  url: string;
}

export function isAuthorizedFrame(
  senderId: number,
  windowId: number | undefined,
  frame: FrameIdentity | null,
  top: FrameIdentity | undefined,
  development: boolean,
): boolean {
  return windowId !== undefined && senderId === windowId && frame !== null && top !== undefined
    && frame.processId === top.processId && frame.routingId === top.routingId
    && isRendererDocument(frame.url, development);
}
