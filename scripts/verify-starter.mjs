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
import { applyDeliveryFixture, verifyDelivery, verifySharedAssets } from './verify-delivery.mjs';
import { verifyDeveloper } from './verify-developer.mjs';
import { fixtureIdentity, identityBrowser, verifyIdentity, verifySecureCookie } from './verify-identity.mjs';

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

const appEnvironment = { ...process.env };
delete appEnvironment.NODE_ENV;
const vite = await createServer({ root, configFile: false, server: { middlewareMode: true, watch: null, ws: false } });

async function inventoryRequests(url) {
  async function call(path, status, method = 'GET', fields) {
    const response = await fetch(url + '/api/crud/' + path, {
      method, ...(fields ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) } : {}),
    });
    assert.equal(response.status, status, method + ' ' + path);
    return response.json();
  }
  assert.deepEqual(await call('products', 200), { data: { rows: [], hasMore: false } });
  await call('categories', 201, 'POST', { id: 1, name: 'Tools' });
  await call('suppliers', 201, 'POST', { id: 1, name: 'Warehouse Direct' });
  await call('warehouses', 201, 'POST', { id: 1, name: 'Central' });
  await call('products', 400, 'POST', { id: 1, bogus: true });
  await call('products', 409, 'POST', { id: 1, sku: 'A-001', name: 'Hammer', category_id: 999 });
  const product = { id: 1, sku: 'A-001', name: "Maker's Hammer", category_id: 1, supplier_id: 1 };
  assert.deepEqual(await call('products', 201, 'POST', product), { data: { ...product, active: true } });
  await call('products', 409, 'POST', { ...product, id: 2 });
  await call('products', 409, 'POST', { ...product, id: 3, sku: 'A-003', name: '' });
  await call('products', 201, 'POST', { ...product, id: 4, sku: 'A-004', name: 'Hammer Spare' });
  assert.equal((await call('products?limit=1&q=Hammer', 200)).data.hasMore, true);
  assert.deepEqual((await call('products?q=' + encodeURIComponent("' OR TRUE"), 200)).data.rows, []);
  assert.equal((await call('products/record?id=1', 200)).data.name, product.name);
  assert.equal((await call('products/record?id=1', 200, 'PATCH', { name: 'Workshop Hammer' })).data.name, 'Workshop Hammer');
  await call('products/record?id=1', 400, 'PATCH', { id: 3 });
  await call('categories/record?id=1', 409, 'DELETE');
  assert.deepEqual(await call('suppliers/record?id=1', 200, 'DELETE'), { data: { deleted: true } });
  assert.equal((await call('products/record?id=1', 200)).data.supplier_id, null);
  await call('stock_movements', 409, 'POST', { id: 1, product_id: 1, warehouse_id: 1, quantity: 0 });
  assert.match((await call('stock_movements', 201, 'POST', { id: 1, product_id: 1, warehouse_id: 1, quantity: 10 })).data.recorded_on, /^\d{4}-\d{2}-\d{2}$/u);
  await call('products/record?id=1', 409, 'DELETE');
  await call('stock_movements/record?id=1', 200, 'DELETE');
  await call('products/record?id=4', 200, 'DELETE');
  await call('products/record?id=4', 404);
}

async function inventoryBrowser(page, incremental) {
  if (incremental) {
    await page.getByRole('combobox', { name: 'Table' }).selectOption('suppliers');
    await page.getByRole('button', { name: 'New Record' }).click();
    const supplier = page.getByRole('form', { name: 'Create record' });
    await supplier.getByRole('spinbutton', { name: 'Id', exact: true }).fill('8');
    await supplier.getByRole('textbox', { name: 'Name', exact: true }).fill('Browser Supplier');
    await supplier.getByRole('button', { name: 'Save Record' }).click();
    const row = page.getByRole('row', { name: /Browser Supplier/u });
    await row.getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('form', { name: 'Edit record' }).getByRole('textbox', { name: 'Name', exact: true }).fill('Updated Supplier');
    await page.getByRole('button', { name: 'Save Record' }).click();
    const updated = page.getByRole('row', { name: /Updated Supplier/u });
    await updated.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete Record' }).click();
    await updated.waitFor({ state: 'hidden' });
  }
  await page.getByRole('combobox', { name: 'Table' }).selectOption('products');
  await page.getByRole('cell', { name: 'Workshop Hammer' }).waitFor();
  await page.getByRole('button', { name: 'New Record' }).click();
  const create = page.getByRole('form', { name: 'Create record' });
  await create.getByRole('spinbutton', { name: 'Id', exact: true }).fill('5');
  await create.getByRole('textbox', { name: 'Sku', exact: true }).fill('A-005');
  await create.getByRole('textbox', { name: 'Name', exact: true }).fill('Browser Product');
  await create.getByRole('spinbutton', { name: 'Category Id', exact: true }).fill('1');
  await create.getByRole('button', { name: 'Save Record' }).click();
  const row = page.getByRole('row', { name: /Browser Product/u });
  await row.waitFor();
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('form', { name: 'Edit record' }).getByRole('textbox', { name: 'Name', exact: true }).fill('Browser Updated');
  await page.getByRole('button', { name: 'Save Record' }).click();
  const updated = page.getByRole('row', { name: /Browser Updated/u });
  await updated.getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('button', { name: 'Delete Record' }).click();
  await page.getByText('Record deleted.', { exact: true }).waitFor();
  await updated.waitFor({ state: 'hidden' });
}

async function addSuppliers(fixture, go) {
  const { IncrementalStudio } = await vite.ssrLoadModule('/apps/desktop/src/main/services/incremental/studio.ts');
  const { IncrementalStore } = await vite.ssrLoadModule('/apps/desktop/src/main/services/incremental/storage.ts');
  const { admitRoot } = await vite.ssrLoadModule('/apps/desktop/src/main/services/projects/filesystem.ts');
  const { success } = await vite.ssrLoadModule('/packages/contracts/src/index.ts');
  const rootGrant = await admitRoot(fixture);
  const userData = await mkdtemp(join(tmpdir(), 'studio-incremental-profile-'));
  const projectId = randomUUID();
  const migration = await readFile(resolve(root, 'tests/fixtures/suppliers.sql'), 'utf8');
  const migrationPath = join(fixture, 'db/migrations/0003_suppliers.sql');
  const service = go ? 'internal/records/service.go' : 'server/features/crud/service.ts';
  const servicePath = join(fixture, service);
  const custom = (await readFile(servicePath, 'utf8')) + '\n// Existing inventory approval policy.\n';
  const studio = new IncrementalStudio(new IncrementalStore(userData), {
    root: (id) => id === projectId ? rootGrant : undefined,
    project: async () => undefined, git: async () => success({ state: 'not-repository', detail: 'Standalone fixture' }),
    gitWriting: () => false, schemaPending: async () => false, refresh: async () => undefined,
  }, { confirm: async (_title, detail) => detail.includes('Plan SHA-256') });
  const verified = (result) => {
    assert(result.ok, result.error);
    return result.value;
  };
  try {
    await writeFile(servicePath, custom);
    await writeFile(migrationPath, migration, { flag: 'wx' });
    if (go) {
      const entrypoint = join(fixture, 'internal/httpapp/http.go');
      const original = await readFile(entrypoint, 'utf8');
      await writeFile(entrypoint, original + '\n// Local routing policy.\n');
      const revision = verified(await studio.inspect(projectId)).revision;
      const conflict = verified(await studio.preview({ projectId, revision, backend: ['suppliers'], frontend: ['suppliers'] }));
      assert(conflict.changes.some(({ path, action }) => path === 'internal/httpapp/http.go' && action === 'conflict'));
      assert.equal((await studio.action({ projectId, id: conflict.id }, 'apply')).ok, false);
      const incompatible = verified(await studio.preview({ projectId, revision, backend: [], frontend: [],
        modules: [{ id: 'authentication', version: '1.0.0' }] }));
      assert(incompatible.issues.some((issue) => issue.includes('no verified optional module releases')));
      assert.equal(await readFile(entrypoint, 'utf8'), original + '\n// Local routing policy.\n');
      await writeFile(entrypoint, original);
    }
    const inspected = verified(await studio.inspect(projectId));
    const select = { projectId, revision: inspected.revision, backend: ['suppliers'], frontend: ['suppliers'] };
    assert(inspected.sources.some(({ name, external }) => name === '0003_suppliers.sql' && external));
    const review = verified(await studio.preview(select));
    assert.deepEqual(review.issues, []);
    assert(review.changes.some(({ path, action }) => path === service && action === 'protected'));
    assert(!review.changes.some(({ path }) => path.startsWith('db/')));
    const applied = verified(await studio.action({ projectId, id: review.id }, 'apply'));
    assert.deepEqual(applied.issues, []);
    assert.equal(await readFile(servicePath, 'utf8'), custom);
    assert.equal(await readFile(migrationPath, 'utf8'), migration);
    const repeat = verified(await studio.preview({ ...select, revision: applied.revision }));
    assert.deepEqual(repeat.issues, []);
    assert(!repeat.changes.some(({ action }) => action === 'create' || action === 'modify'));
  } finally {
    studio.dispose();
    await rm(userData, { recursive: true, force: true, maxRetries: 5 });
  }
}

async function installIdentity(fixture, authentication) {
  const { IncrementalStudio } = await vite.ssrLoadModule('/apps/desktop/src/main/services/incremental/studio.ts');
  const { IncrementalStore } = await vite.ssrLoadModule('/apps/desktop/src/main/services/incremental/storage.ts');
  const { admitRoot } = await vite.ssrLoadModule('/apps/desktop/src/main/services/projects/filesystem.ts');
  const { success } = await vite.ssrLoadModule('/packages/contracts/src/index.ts');
  const profile = await mkdtemp(join(tmpdir(), 'studio-module-install-'));
  const admitted = await admitRoot(fixture);
  const projectId = randomUUID();
  const custom = '// Client-specific service code.\nexport const inventoryPolicy = "review before shipment";\n';
  const customPath = join(fixture, 'server/client-policy.ts');
  const studio = new IncrementalStudio(new IncrementalStore(profile), {
    root: (id) => id === projectId ? admitted : undefined, project: async () => undefined,
    git: async () => success({ state: 'not-repository', detail: 'Standalone fixture' }),
    gitWriting: () => false, schemaPending: async () => false, refresh: async () => undefined,
  }, { confirm: async (_title, detail) => detail.includes('Plan SHA-256') });
  const value = (result) => { assert(result.ok, result.error); return result.value; };
  try {
    await writeFile(customPath, custom, { flag: 'wx' });
    const before = value(await studio.inspect(projectId));
    const input = { projectId, revision: before.revision, backend: [], frontend: [], modules: [authentication] };
    const review = value(await studio.preview(input));
    assert.deepEqual(review.issues, []);
    assert(review.changes.some(({ path, action }) => path.endsWith('_authentication.sql') && action === 'create'));
    const after = value(await studio.action({ projectId, id: review.id }, 'apply'));
    assert.deepEqual(after.issues, []);
    assert.equal(await readFile(customPath, 'utf8'), custom);
    const repeat = value(await studio.preview({ ...input, revision: after.revision }));
    assert.deepEqual(repeat.changes, []);
  } finally { studio.dispose(); await rm(profile, { recursive: true, force: true, maxRetries: 5 }); }
}

async function verify(plan, demo, inventory, incremental, identity, authentication, go, design, delivery) {
  const fixture = await mkdtemp(join(tmpdir(), 'studio-generated-app-'));
  const port = plan.config.port;
  const url = 'http://127.0.0.1:' + port;
  const env = { ...appEnvironment, HOST: '127.0.0.1', PORT: String(port), DATABASE_URL: '', TEST_DATABASE_URL: '' };
  if (go) {
    env.GOTOOLCHAIN = 'local';
    env.GOFLAGS = '-buildvcs=false';
  }
  if (identity) {
    env.AUTH_ORIGIN = url;
    env.AUTH_ALLOW_INSECURE_LOOPBACK = '1';
    env.AUTH_BOOTSTRAP_EMAIL = fixtureIdentity.email;
  }
  const fromProject = createRequire(join(fixture, 'package.json'));
  const fromStudio = createRequire(resolve(root, 'apps/desktop/package.json'));
  let server;
  let development;
  let client;
  let schema;
  let schemaCreated = false;
  try {
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
    const goCommand = (args, expected = 0) => {
      const result = spawnSync('go', args, { cwd: fixture, env, encoding: 'utf8', timeout: 240_000 });
      assert.equal(result.status, expected, 'go ' + args.join(' ') + '\n' + (result.stdout ?? '') + (result.stderr ?? '') + (result.error ?? ''));
      return result.stdout;
    };
    const binary = join(fixture, process.platform === 'win32' ? 'factory-server.exe' : 'factory-server');
    const launch = () => go
      ? spawn(binary, [], { cwd: fixture, env, stdio: 'inherit' })
      : spawn(process.execPath, ['--experimental-strip-types', 'server/server.ts'], { cwd: fixture, env, stdio: 'inherit' });
    const migrate = (expected = 0) => go ? goCommand(['run', '-mod=readonly', './cmd/migrate'], expected) : run('db:migrate');
    const buildGo = () => goCommand(['build', '-mod=readonly', '-o', binary, './cmd/server']);
    run('install', '--frozen-lockfile');
    if (go) {
      assert.match(goCommand(['version']), /go1\.26\.11 /u);
      goCommand(['mod', 'download']);
      goCommand(['mod', 'verify']);
      if (process.env.FACTORY_GO_SECURITY === '1') {
        run('audit', '--prod', '--audit-level', 'high');
        const database = process.env.FACTORY_GO_VULNERABILITY_DB;
        const audit = spawnSync('govulncheck', [...(database ? ['-db', database] : []), './...'],
          { cwd: fixture, env, encoding: 'utf8', timeout: 240_000 });
        const report = (audit.stdout ?? '') + (audit.stderr ?? '') + (audit.error ?? '');
        assert.equal(audit.status, 0, report);
        console.log(report.trim());
      }
    }

    // Give each configuration a fresh schema in the dedicated fixture database.
    // The identifier is generated here and cannot contain externally supplied SQL.
    if (database) {
      const { Client } = (go ? fromStudio : fromProject)('pg');
      client = new Client({ connectionString: database });
      await client.connect();
      schema = 'starter_' + randomUUID().replaceAll('-', '');
      await client.query('CREATE SCHEMA ' + schema);
      schemaCreated = true;
      const connection = new URL(database);
      connection.searchParams.set('options', '-csearch_path=' + schema);
      env.DATABASE_URL = connection.href;
      env.TEST_DATABASE_URL = connection.href;
    }

    if (incremental) {
      if (database) migrate();
      if (go) buildGo();
      server = launch();
      await ready(server, url + '/api/health');
      assert.equal((await fetch(url + '/api/crud/products')).status, database ? 200 : 503);
      assert.equal((await fetch(url + '/api/crud/suppliers')).status, 404);
      await stop(server);
      server = undefined;
      await addSuppliers(fixture, go);
    }
    if (identity === 'installed') {
      if (database) run('db:migrate');
      await installIdentity(fixture, authentication);
    }
    run('lint');
    run('typecheck');
    if (delivery) await applyDeliveryFixture(vite, fixture);
    if (go) {
      const sources = plan.files.filter(({ path }) => path.endsWith('.go')).map(({ path }) => path);
      assert.equal(spawnSync('gofmt', ['-l', ...sources], { cwd: fixture, encoding: 'utf8' }).stdout.trim(), '');
      goCommand(['vet', '-mod=readonly', './...']);
      goCommand(['test', '-mod=readonly', './...']);
      goCommand(['build', '-mod=readonly', './cmd/...']);
      buildGo();
    } else run('test');
    run('build');
    if (database) migrate();
    if (database && go) {
      const baseline = join(fixture, 'db/migrations/0001_baseline.sql');
      const before = await readFile(baseline, 'utf8');
      await writeFile(baseline, before + '\n-- Different checksum.\n');
      migrate(1);
      await writeFile(baseline, before);
      const invalid = join(fixture, 'db/migrations/0099_rejected.sql');
      await writeFile(invalid, 'CREATE TABLE rollback_review (id int); SELECT no_such_column FROM rollback_review;');
      migrate(1);
      await rm(invalid);
      assert.equal((await client.query('SELECT to_regclass($1) AS name', [schema + '.rollback_review'])).rows[0].name, null);
      assert.match(migrate(), /Applied migrations: 0/u);
    }
    if (identity && database) {
      const boot = () => spawnSync(process.execPath, ['--experimental-strip-types', 'server/features/identity/bootstrap.ts'], {
        cwd: fixture, env, input: fixtureIdentity.password + '\n', encoding: 'utf8', timeout: 15_000,
      });
      assert.equal(boot().status, 0, 'The first administrator must be created.');
      assert.equal(boot().status, 1, 'Administrator bootstrap must be exclusive.');
    }
    const viteBin = join(dirname(fromProject.resolve('vite/package.json')), 'bin', 'vite.js');
    const developmentPort = await freePort();
    const developmentUrl = 'http://127.0.0.1:' + developmentPort;
    server = launch();
    await ready(server, url + '/api/health');
    development = spawn(process.execPath, [viteBin, '--strictPort', '--port', String(developmentPort)], { cwd: fixture, env, stdio: 'inherit' });
    await ready(development, developmentUrl + '/api/health');
    assert.equal((await fetch(developmentUrl + '/api/ready')).status, database ? 200 : 503);
    await stop(development);
    development = undefined;
    await stop(server);

    server = go ? launch() : spawn(process.execPath, ['--env-file-if-exists=.env', 'dist/server/server.js'], { cwd: fixture, env, stdio: 'inherit' });
    await ready(server, url + '/api/health');
    const readiness = await fetch(url + '/api/ready');
    assert.equal(readiness.status, database ? 200 : 503);
    if (database) assert.deepEqual(await readiness.json(), { data: { status: 'ready', ...(go ? {} : { database: 'postgresql' }) } });
    const welcome = await fetch(url + '/api/welcome');
    assert.equal(welcome.status, identity ? (database ? 401 : 503) : demo ? (database ? 200 : 503) : 404);
    if (database && demo) assert.deepEqual(await welcome.json(), { data: { message: 'Welcome from PostgreSQL.' } });
    if (database && identity) await verifyIdentity(url, client, schema, identity === 'full');
    else if (database && inventory) {
      await inventoryRequests(url);
      if (go) {
        const request = await fetch(url + '/api/crud/products?limit=1&limit=2');
        assert.equal(request.status, 400);
        const patch = (fields) => fetch(url + '/api/crud/warehouses/record?id=1', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields),
        });
        assert.equal((await patch({ aisle: 32768 })).status, 400);
        assert.equal((await patch({ external_id: 'invalid-uuid' })).status, 400);
        const external_id = randomUUID();
        assert.deepEqual((await (await patch({ external_id, aisle: 42 })).json()).data, { id: 1, name: 'Central', external_id, aisle: 42 });
        assert.equal((await (await patch({ external_id: null })).json()).data.external_id, null);
      }
    }
    if (design) {
      const page = await fetch(url + '/studio-page.html');
      assert.equal(page.status, 200);
      assert((await page.text()).includes('<title>Studio page</title>'));
    }
    const frontend = await (await fetch(url)).text();
    assert(frontend.includes('<title>Inventory Portal</title>'));
    const bundle = /<script[^>]+src="([^"]+)"/u.exec(frontend)?.[1];
    assert(bundle && (await fetch(url + bundle)).ok);
    if (process.env.FACTORY_STARTER_BROWSER === '1') {
      const { chromium } = fromStudio('@playwright/test');
      const browser = await chromium.launch({
        chromiumSandbox: true,
        ...(process.env.FACTORY_CHROMIUM_PATH ? { executablePath: process.env.FACTORY_CHROMIUM_PATH } : {}),
      });
      try {
        const page = await browser.newPage();
        await page.goto(url);
        if (identity) {
          if (database) await identityBrowser(page, identity === 'full', plan.config.library.branding.mark);
          else await page.getByRole('heading', { name: 'Sign in' }).waitFor();
        } else {
          await page.getByRole('heading', { name: 'Inventory Portal' }).waitFor();
          await page.getByText(database ? 'PostgreSQL ready.' : 'PostgreSQL unavailable.', { exact: true }).waitFor();
          if (demo) await page.getByText(database ? 'Welcome from PostgreSQL.' : /The welcome example is unavailable/u).waitFor();
          else assert.equal(await page.getByRole('heading', { name: 'Welcome example' }).count(), 0);
          if (go) await page.getByText('GO', { exact: true }).waitFor();
          if (inventory && database) await inventoryBrowser(page, incremental);
          if (design) {
            await page.goto(url + '/studio-page.html');
            await page.getByRole('heading', { name: 'Inventory review' }).waitFor();
            await page.getByText('DP', { exact: true }).waitFor();
            if (database) {
              await page.getByRole('table').getByRole('cell', { name: 'Workshop Hammer' }).waitFor();
            } else {
              await page.getByRole('alert').getByText('The data request failed.').waitFor();
            }
          }
        }
      } finally {
        await browser.close();
      }
    }
    if (database && identity === 'full') {
      await stop(server);
      const origin = 'https://inventory.fixture.invalid';
      server = spawn(process.execPath, ['dist/server/server.js'], { cwd: fixture, env: { ...env, AUTH_ORIGIN: origin }, stdio: 'inherit' });
      await ready(server, url + '/api/health');
      await verifySecureCookie(url, origin);
    }
    if (design || (go && incremental)) {
      await stop(server);
      server = undefined;
      await verifyDeveloper(vite, fixture, env, developmentPort);
    }
    if (delivery) {
      await stop(server);
      server = undefined;
      if (go) await rm(binary, { force: true });
      if (process.platform === 'linux') {
        const ci = spawnSync('bash', ['delivery/verify.sh'], { cwd: fixture, env, stdio: 'inherit', timeout: 240_000 });
        assert.equal(ci.status, 0, 'Generated CI command sequence failed.');
        if (go) {
          // Studio's build verifies the outputs from its own reviewed platform commands.
          await rm(join(fixture, 'dist', 'factory-server'), { force: true });
          await rm(join(fixture, 'dist', 'factory-migrate'), { force: true });
        }
      }
      await verifyDelivery(vite, fixture, env, go, packageManager, port);
    }
    const instructions = await readFile(join(fixture, 'AGENTS.md'), 'utf8');
    if (go) {
      assert(instructions.includes('Go 1.26.11'));
      assert(instructions.includes(delivery ? 'Client Delivery' : 'Client delivery v2'));
      assert(!instructions.includes('Express') && !instructions.includes('pnpm db:migrate'));
      assert((await readFile(join(fixture, 'docs/ENGINEERING_PROFILE.md'), 'utf8')).includes('Go Service conventions'));
      if (server) assert.equal((await fetch(url + '/api/auth/session')).status, 404);
    } else assert(instructions.includes('Standard Engineering profile v1'));
    assert.equal(instructions.includes('Welcome example'), demo);
    if (identity) {
      assert(instructions.includes(delivery ? 'Client Delivery' : 'Client delivery v2'));
      const profileGuide = await readFile(join(fixture, 'docs', 'ENGINEERING_PROFILE.md'), 'utf8');
      assert(profileGuide.includes('Use disposable PostgreSQL schemas.'));
      assert.equal(instructions.includes('rbac v1.0.0'), identity === 'full');
    } else {
      assert.equal(instructions.includes('Installed identity releases'), false);
    }
    if (client) {
      const { rows } = await client.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', [schema]);
      const expected = ['schema_migrations', ...(demo ? ['welcome_messages'] : []), ...(inventory ? plan.config.crud.schema.tables.map(({ name }) => name) : []), ...(incremental ? ['suppliers'] : [])];
      if (identity) {
        expected.push('factory_identity_users', 'factory_identity_sessions', 'factory_identity_attempts');
        if (identity === 'full') expected.push('factory_identity_roles', 'factory_identity_role_permissions', 'factory_identity_user_roles', 'factory_identity_audit');
      }
      assert.deepEqual(rows.map(({ table_name }) => table_name), expected.sort());
    }
    console.log('Standalone ' + (go ? 'Go ' : '') + (identity ? identity + ' identity' : incremental ? 'incremental inventory CRUD' : inventory ? 'inventory CRUD' : demo ? 'Welcome example' : 'foundation') + ' verified with' + (database ? ' PostgreSQL.' : 'out a database connection.'));
  } finally {
    try {
      await stop(development);
      await stop(server);
      if (schemaCreated) await client.query('DROP SCHEMA ' + schema + ' CASCADE');
    } finally {
      await client?.end();
      await rm(fixture, { recursive: true, force: true, maxRetries: 5 });
    }
  }
}

try {
  const { planProject, readIncrementalProject, composeDesign, sha256 } = await vite.ssrLoadModule('/packages/generator/src/index.ts');
  const { AUTHENTICATION, GO_STACK, IDENTITY_MODULES, BUSINESS_TEMPLATE, STARTER, STACKS, WELCOME_EXAMPLE } = await vite.ssrLoadModule('/packages/contracts/src/index.ts');
  const { parseSql } = await vite.ssrLoadModule('/packages/schema/src/index.ts');
  const inventorySql = await readFile(resolve(root, 'tests/fixtures/inventory.sql'), 'utf8');
  const { schema: inventory, diagnostics } = parseSql(inventorySql);
  assert.deepEqual(diagnostics, []);
  const installedFixtures = process.env.FACTORY_INSTALLED_FIXTURES;
  if (installedFixtures) {
    assert(database, 'Use a disposable PostgreSQL database to verify installed generator output.');
    for (const kind of ['node', 'go']) {
      const go = kind === 'go';
      const directory = join(installedFixtures, kind);
      const metadata = ['package.json', '.env.example', '.factory/project.json', '.factory/generation-manifest.json',
        '.factory/versions.lock.json', '.factory/modules.json', '.factory/engineering.json'];
      const read = async (path) => {
        const content = await readFile(join(directory, path), 'utf8');
        return { path, content, sha256: sha256(content), state: 'text' };
      };
      const project = readIncrementalProject(new Map(await Promise.all(metadata.map(async (path) => [path, await read(path)]))));
      assert.equal(project.config.stack, go ? GO_STACK : STARTER.stack);
      const schema = go ? parseSql(inventorySql + 'ALTER TABLE warehouses ADD COLUMN external_id uuid; ALTER TABLE warehouses ADD COLUMN aisle smallint;' +
        'CREATE TABLE supplies (id integer PRIMARY KEY, name text NOT NULL);').schema : inventory;
      const tables = schema.tables.map(({ name }) => name);
      const config = { ...project.config, crud: { schema, migrations: true, backend: tables, frontend: tables } };
      const expected = planProject(config, project.projectId);
      const files = await Promise.all(expected.files.map(async (entry) => {
        const output = await read(entry.path);
        assert.equal(output.sha256, entry.sha256, 'Installed generator output does not match the reviewed plan: ' + entry.path);
        return output;
      }));
      console.log('Verifying standalone files emitted by the installed Studio: ' + kind);
      await verify({ config, files }, false, true, false, go ? undefined : 'full', AUTHENTICATION, go, false, false);
    }
  } else {
    const profile = { kind: 'profile', id: randomUUID(), version: 2, name: 'Client delivery', advice: { Testing: 'Use disposable PostgreSQL schemas.' } };
    const shared = await verifySharedAssets(vite);
    const variants = process.env.FACTORY_STARTER_VARIANT ? [process.env.FACTORY_STARTER_VARIANT]
      : ['foundation', 'welcome', 'inventory', 'incremental', 'identity', 'installed', 'go-foundation', 'go-inventory'];
    for (const variant of variants) {
      const go = variant.startsWith('go-');
      const identity = variant === 'identity' ? 'full' : variant === 'installed' ? 'installed' : undefined;
      const design = variant === 'inventory';
      const delivery = variant === 'identity' || variant === 'go-inventory';
      const records = Boolean(identity || design || variant === 'incremental' || variant === 'go-inventory');
      const demo = variant === 'welcome';
      const incremental = variant === 'incremental' || variant === 'go-inventory';
      const selectedSchema = identity === 'installed'
        ? parseSql('CREATE TABLE products (id integer PRIMARY KEY, name text NOT NULL);').schema
        : incremental ? { ...inventory, tables: inventory.tables.filter(({ name }) => name !== 'suppliers')
        .map((table) => table.name !== 'products' ? table : { ...table, columns: table.columns.filter(({ name }) => name !== 'supplier_id'),
          constraints: table.constraints.filter(({ name }) => name !== 'products_supplier_id_fkey') }) } : inventory;
      const types = go && incremental ? parseSql('ALTER TABLE warehouses ADD COLUMN external_id uuid; ALTER TABLE warehouses ADD COLUMN aisle smallint;', selectedSchema) : null;
      if (types) assert.deepEqual(types.diagnostics, []);
      const schema = types?.schema ?? selectedSchema;
      const tables = schema.tables.map(({ name }) => name);
      const stack = STACKS[go ? GO_STACK : STARTER.stack];
      const plan = planProject({
        name: 'Inventory Portal', slug: 'inventory-portal', port: await freePort(),
        appType: STARTER.appType, stack: stack.id, database: STARTER.database,
        architecture: stack.architecture, engineering: STARTER.engineering, modules: identity === 'full' ? [...IDENTITY_MODULES] : demo ? [WELCOME_EXAMPLE] : [],
        ...(records ? { crud: { schema, migrations: true, backend: tables, frontend: tables } } : {}),
        ...(identity || go || design ? { library: { profile: delivery ? shared.profile : profile, template: delivery ? shared.template : BUSINESS_TEMPLATE,
          branding: { color: identity === 'full' ? '#2458a4' : '#594688', theme: 'dark', mark: go ? 'GO' : design ? 'DP' : identity === 'full' ? 'IN' : 'CL' } } } : {}),
      }, randomUUID());
      if (go) {
        const node = planProject({ ...plan.config, stack: STARTER.stack, architecture: STARTER.architecture }, randomUUID());
        const get = (value, path) => value.files.find((entry) => entry.path === path)?.content;
        assert.notEqual(node.projectId, plan.projectId);
        assert.equal(get(node, '.factory/engineering.json'), get(plan, '.factory/engineering.json'));
        assert.notEqual(get(node, 'AGENTS.md'), get(plan, 'AGENTS.md'));
        assert(!get(node, 'go.mod') && !get(plan, 'server/app.ts'));
        assert.throws(() => planProject({ ...plan.config, modules: [AUTHENTICATION] }, randomUUID()));
        assert.deepEqual(planProject(plan.config, plan.projectId), plan);
      }
      if (design) {
        const files = new Map(plan.files.map((file) => [file.path, { state: 'text', ...file }]));
        const unchanged = files.get('web/main.tsx');
        const path = 'web/features/StudioPage.tsx';
        for (const missing of [path, 'docs/STUDIO_PAGE.md', 'web/studio-page.html']) files.set(missing, { state: 'absent' });
        const project = readIncrementalProject(files);
        const reviewed = composeDesign(project, files, schema, { generate: true,
          entry: { kind: 'page', id: 'inventory-review', title: 'Inventory review', description: 'Current stock records.', layout: 'table', api: 'list-products', columns: ['id', 'name'] } });
        assert.deepEqual(reviewed.issues, []);
        assert(reviewed.changes.some((entry) => entry.path === path && entry.action === 'create'));
        for (const change of reviewed.changes) {
          assert(change.after !== null);
          files.set(change.path, { path: change.path, content: change.after, sha256: sha256(change.after), state: 'text' });
        }
        assert.equal(files.get('web/main.tsx'), unchanged);
        readIncrementalProject(files);
        plan.files = [...files.values()].filter((file) => file.state === 'text');
      }
      await verify(plan, demo, records, incremental, identity, AUTHENTICATION, go, design, delivery);
    }
  }
} finally {
  await vite.close();
}
