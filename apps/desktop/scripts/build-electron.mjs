import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const electronBuild = {
  absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: { 'main/index': 'src/main/index.ts', 'preload/index': 'src/preload/index.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  target: 'node22',
  bundle: true,
  external: ['electron'],
  format: 'cjs',
  logLevel: 'info',
  plugins: [{
    name: 'bundle-starter-templates',
    setup(build) {
      build.onResolve({ filter: /\?raw$/ }, (args) => ({
        path: resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'starter-template',
      }));
      build.onLoad({ filter: /.*/, namespace: 'starter-template' }, async (args) => ({
        contents: await readFile(args.path, 'utf8'), loader: 'text', watchFiles: [args.path],
      }));
    },
  }],
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await build(electronBuild);
}
