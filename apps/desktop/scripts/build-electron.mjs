import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

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
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await build(electronBuild);
}
