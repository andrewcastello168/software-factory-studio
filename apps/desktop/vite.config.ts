import { randomBytes } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import addresses from './addresses.json' with { type: 'json' };

export default defineConfig(({ command, mode }) => {
  const nonce = randomBytes(18).toString('base64');
  const native = mode === 'native';
  const origin = new URL(native ? addresses.desktop : addresses.browser);
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}'`, `style-src 'self' 'nonce-${nonce}'`,
    native ? `connect-src 'self' ws://${origin.host}` : "connect-src 'self' ws: wss:",
    "object-src 'none'", "base-uri 'none'", "frame-src 'none'", "frame-ancestors 'none'", "form-action 'none'",
  ].join('; ');
  return {
    plugins: [react(), tailwindcss()],
    ...(command === 'serve' ? { html: { cspNonce: nonce } } : {}),
    build: { outDir: 'dist/renderer', emptyOutDir: true, target: 'chrome120' },
    server: {
      host: origin.hostname,
      port: Number(origin.port),
      strictPort: true,
      headers: { 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff' },
    },
  };
});
