import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'PORT');
  const port = Number(env.PORT ?? @@PORT@@);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT is invalid.');
  return {
    root: 'web',
    plugins: [react()],
    build: { outDir: resolve('dist/web'), emptyOutDir: true },
    server: {
      host: '127.0.0.1',
      proxy: { '/api': 'http://127.0.0.1:' + port },
    },
  };
});
