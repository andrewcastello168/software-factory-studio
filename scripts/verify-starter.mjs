import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as tcpServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { createServer } from 'vite';

const { fetch, AbortSignal, URL } = globalThis;
const root = fileURLToPath(new URL('../', import.meta.url));
const packageManager = process.env.npm_execpath;
if (!packageManager || !/pnpm\.(?:c?js|mjs)$/iu.test(packageManager)) throw new Error('Run this check through pnpm.');
const database = process.env.FACTORY_TEST_DATABASE_URL;
if (process.env.FACTORY_REQUIRE_DATABASE === '1' && !database) throw new Error('A disposable PostgreSQL test database is required.');
if (database) {
  let target;
  try { target = new URL(database); } catch { /* Report without the connection string. */ }
  if (!target || !['postgres:', 'postgresql:'].includes(target.protocol)
    || target.hostname !== '127.0.0.1' || target.pathname !== '/factory_check') {
    throw new Error('Use the dedicated loopback factory_check verification database.');
  }
}

async function freePort() {
  const server = tcpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise((done) => server.close(done));
  return address.port;
}

async function ready(process, url) {
  for (let attempt = 0; attempt < 45; attempt++) {
    if (process.exitCode !== null) throw new Error('Generated server exited.');
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) }).catch(() => null);
    if (response?.ok) return;
    await wait(250);
  }
  throw new Error('Generated server did not start.');
}

async function stop(process) {
  if (!process || process.exitCode !== null) return;
  const exited = once(process, 'exit').catch(() => undefined);
  process.kill();
  await Promise.race([exited, wait(3000)]);
}

const fixture = await mkdtemp(join(tmpdir(), 'studio-generated-app-'));
const port = await freePort();
const url = 'http://127.0.0.1:' + port;
const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: database ?? '', TEST_DATABASE_URL: database ?? '' };
const vite = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null } });
let server;
let development;
try {
  const { planProject } = await vite.ssrLoadModule('/packages/generator/src/index.ts');
  const { STARTER } = await vite.ssrLoadModule('/packages/contracts/src/index.ts');
  const plan = planProject({
    name: 'Inventory Portal', slug: 'inventory-portal', port,
    appType: STARTER.appType, stack: STARTER.stack, architecture: STARTER.architecture, engineering: STARTER.engineering,
  }, randomUUID());
  for (const file of plan.files) {
    const target = join(fixture, file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: 'wx' });
  }
  const run = (...args) => {
    const result = spawnSync(process.execPath, [packageManager, ...args], {
      cwd: fixture, env, stdio: 'inherit', timeout: 150_000,
    });
    if (result.status !== 0) throw new Error('Generated project command failed: pnpm ' + args.join(' '));
  };
  run('install', '--frozen-lockfile');
  run('lint');
  run('typecheck');
  run('test');
  run('build');
  if (database) run('db:migrate');

  // Verify the documented development entry points and Vite's real API proxy.
  const developmentPort = await freePort();
  const developmentUrl = 'http://127.0.0.1:' + developmentPort;
  const fromProject = createRequire(join(fixture, 'package.json'));
  const viteBin = join(dirname(fromProject.resolve('vite/package.json')), 'bin', 'vite.js');
  server = spawn(process.execPath, ['--experimental-strip-types', 'server/server.ts'], { cwd: fixture, env, stdio: 'inherit' });
  await ready(server, url + '/api/health');
  development = spawn(process.execPath, [viteBin, '--strictPort', '--port', String(developmentPort)], { cwd: fixture, env, stdio: 'inherit' });
  await ready(development, developmentUrl + '/api/health');
  assert.equal((await fetch(developmentUrl + '/api/welcome')).status, database ? 200 : 503);
  await stop(development);
  development = undefined;
  await stop(server);

  // The generated start command runs this same executable and arguments.
  server = spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/server/server.js'], { cwd: fixture, env, stdio: 'inherit' });
  await ready(server, url + '/api/health');
  const welcome = await fetch(url + '/api/welcome');
  assert.equal(welcome.status, database ? 200 : 503);
  if (database) assert.deepEqual(await welcome.json(), { data: { message: 'Welcome from PostgreSQL.' } });
  const frontend = await (await fetch(url)).text();
  assert(frontend.includes('<title>Inventory Portal</title>'));
  const bundle = /<script[^>]+src="([^"]+)"/u.exec(frontend)?.[1];
  assert(bundle && (await fetch(url + bundle)).ok);
  if (process.env.FACTORY_STARTER_BROWSER === '1') {
    const local = createRequire(resolve(root, 'apps/desktop/package.json'));
    const { chromium } = local('@playwright/test');
    const browser = await chromium.launch({
      chromiumSandbox: true,
      ...(process.env.FACTORY_CHROMIUM_PATH ? { executablePath: process.env.FACTORY_CHROMIUM_PATH } : {}),
    });
    try {
      const page = await browser.newPage();
      await page.goto(url);
      await page.getByRole('heading', { name: 'Inventory Portal' }).waitFor();
      await page.getByText(database ? 'Welcome from PostgreSQL.' : /The welcome message is unavailable/u).waitFor();
    } finally {
      await browser.close();
    }
  }
  assert((await readFile(join(fixture, 'AGENTS.md'), 'utf8')).includes('Standard Engineering profile v1'));
  console.log('Standalone starter verified with' + (database ? ' PostgreSQL persistence.' : 'out a database connection.'));
} finally {
  await stop(development);
  await stop(server);
  await vite.close();
  await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
}
