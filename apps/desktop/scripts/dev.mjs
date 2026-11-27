import { spawn } from 'node:child_process';
import { once } from 'node:events';
import electron from 'electron';
import { context } from 'esbuild';
import { createServer } from 'vite';
import { electronBuild } from './build-electron.mjs';

let server;
let watcher;
let desktop;
let stopping = false;
let restart = Promise.resolve();

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  desktop?.kill();
  await Promise.allSettled([watcher?.dispose(), server?.close()]);
  process.exitCode = code;
}

async function launch() {
  if (stopping) return;
  if (desktop) {
    const previous = desktop;
    desktop = undefined;
    const exited = once(previous, 'exit');
    previous.kill();
    await exited;
  }
  if (stopping) return;
  console.info('[studio] Starting Electron. Renderer updates use Vite HMR.');
  const child = spawn(electron, ['.'], {
    stdio: 'inherit',
    env: { ...process.env, FACTORY_DESKTOP_DEV: '1' },
  });
  desktop = child;
  child.once('error', (error) => {
    console.error('[studio] Electron could not start:', error.message);
    void stop(1);
  });
  child.once('exit', (code, signal) => {
    if (stopping || desktop !== child) return;
    if (code || signal) console.error('[studio] Electron exited:', code ?? signal);
    void stop(code ?? (signal ? 1 : 0));
  });
}

process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

try {
  server = await createServer({ mode: 'native' });
  await server.listen();
  server.printUrls();
  watcher = await context({
    ...electronBuild,
    plugins: [...electronBuild.plugins, {
      name: 'restart-electron',
      setup(build) {
        build.onEnd(({ errors }) => {
          if (!errors.length) {
            restart = restart.then(launch).catch((error) => {
              console.error('[studio] Electron restart failed:', error.message);
              return stop(1);
            });
          }
        });
      },
    }],
  });
  await watcher.watch();
} catch (error) {
  console.error('[studio] Development startup failed:', error instanceof Error ? error.message : error);
  await stop(1);
}
