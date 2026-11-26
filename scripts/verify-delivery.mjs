import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const { AbortSignal, fetch } = globalThis;

function exec(executable, args, cwd, env, stdio = 'inherit') {
  const result = spawnSync(executable, args, { cwd, env, stdio, encoding: 'utf8', timeout: 240_000, windowsHide: true });
  assert.equal(result.status, 0, executable + ' ' + args.join(' ') + '\n' + (result.stderr ?? '') + (result.error ?? ''));
}

async function localhostReady(child, endpoint, expected = 200) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error('Released application exited.');
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    if (response?.status === expected) return;
    await delay(250);
  }
  throw new Error('Released application did not become ready.');
}

async function fixtureServices(vite, parent, grants) {
  const { admitRoot, pathKey } = await vite.ssrLoadModule('/apps/desktop/src/main/services/projects/filesystem.ts');
  const { GitStudio } = await vite.ssrLoadModule('/apps/desktop/src/main/services/git/studio.ts');
  const { findGit } = await vite.ssrLoadModule('/apps/desktop/src/main/services/git/process.ts');
  const { DeveloperStudio } = await vite.ssrLoadModule('/apps/desktop/src/main/services/developer/studio.ts');
  const { DeliveryStudio } = await vite.ssrLoadModule('/apps/desktop/src/main/services/delivery/studio.ts');
  const { DeliveryStore } = await vite.ssrLoadModule('/apps/desktop/src/main/services/delivery/store.ts');
  const { LibraryStore } = await vite.ssrLoadModule('/apps/desktop/src/main/services/library.ts');
  const gitBin = await findGit();
  assert(gitBin);
  const root = (id) => grants.get(id);
  const grant = (path) => [...grants.values()].every((entry) => {
    const rel = relative(pathKey(entry.path), pathKey(path));
    return rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || /^[a-z]:/iu.test(rel);
  });
  const git = new GitStudio({
    root, canOpen: () => true, allowsAuxiliaryPath: grant, adopt: async () => ({ ok: false, error: 'ACCESS_DENIED' }),
    refresh: async () => undefined,
  }, { chooseDirectory: async () => null, confirm: async () => false }, parent);
  const create = (profile, destination) => {
    const store = new DeliveryStore(profile);
    const library = new LibraryStore(profile);
    const dialogs = { chooseDirectory: async () => destination, confirm: async () => true };
    const developer = new DeveloperStudio({ root, git: (id) => git.status(id), allows: grant }, {
      ...dialogs, chooseEditor: async () => null, reveal: () => undefined, copy: () => undefined, openURL: async () => undefined,
    }, store);
    const delivery = new DeliveryStudio({
      root, git: (id) => git.status(id), available: grant, pending: async () => false, refresh: async () => undefined,
    }, dialogs, developer, store, library);
    return { delivery, developer, library };
  };
  const commit = (cwd, message) => {
    exec(gitBin, ['add', '-A'], cwd, process.env, 'pipe');
    exec(gitBin, ['-c', 'user.name=Factory fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'core.hooksPath=' + parent, 'commit', '-m', message], cwd, process.env, 'pipe');
  };
  return { create, admitRoot, git, gitBin, commit };
}

export async function verifySharedAssets(vite) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'studio-team-')));
  const publisher = join(parent, 'Team library');
  const consumer = join(parent, 'Library worktree café');
  const profile1 = join(parent, 'Personal profile');
  const profile2 = join(parent, 'Consumer profile');
  const first = randomUUID();
  const second = randomUUID();
  const roots = new Map();
  const services = await fixtureServices(vite, parent, roots);
  await Promise.all([mkdir(publisher), mkdir(profile1), mkdir(profile2)]);
  const author = services.create(profile1, parent);
  const reader = services.create(profile2, parent);
  try {
    exec(services.gitBin, ['init', '-b', 'main'], publisher, process.env, 'pipe');
    await writeFile(join(publisher, 'README.md'), '# Shared engineering assets\n');
    services.commit(publisher, 'Initialize team library');
    roots.set(first, await services.admitRoot(publisher));
    const profile = { kind: 'profile', id: randomUUID(), name: 'Client Delivery', version: 1, advice: { Testing: 'Use disposable PostgreSQL schemas.' } };
    const template = { kind: 'template', id: randomUUID(), name: 'Client Workspace', version: 1, color: '#254891', theme: 'dark', mark: 'CL' };
    for (const asset of [profile, template]) assert((await author.library.publish(asset)).ok);
    const shared = await author.delivery.export({ projectId: first, assets: [profile, template].map(({ id, version }) => ({ id, version })) });
    assert(shared.ok && shared.value);
    services.commit(publisher, 'Share profile and team interface v1');
    exec(services.gitBin, ['worktree', 'add', '-b', 'consumer', consumer], publisher, process.env, 'pipe');
    roots.set(second, await services.admitRoot(consumer));
    const observed = await reader.delivery.shares(second);
    assert.deepEqual(observed, { ok: true, value: { entries: [shared.value], rejected: 0 } });
    assert.deepEqual(await reader.delivery.import({ projectId: second, digest: shared.value.digest }), { ok: true, value: 2 });
    assert.deepEqual(await reader.delivery.import({ projectId: second, digest: shared.value.digest }), { ok: true, value: 0 });
    const imported = await reader.library.list();
    assert(imported.ok);
    const fromReader = { profile: imported.value.find((asset) => asset.id === profile.id), template: imported.value.find((asset) => asset.id === template.id) };
    const { planProject } = await vite.ssrLoadModule('/packages/generator/src/index.ts');
    const { STARTER } = await vite.ssrLoadModule('/packages/contracts/src/index.ts');
    const { appType, stack, database, architecture, engineering } = STARTER;
    const projects = ['Client Alpha', 'Client Beta'].map((name, index) => planProject({
      name, slug: name.toLowerCase().replace(' ', '-'), port: 3100 + index, appType, stack, database, architecture, engineering, modules: [],
      library: { ...fromReader, branding: { color: index ? '#672812' : '#124471', theme: 'dark', mark: index ? 'B' : 'A' } },
    }, randomUUID()));
    const get = (plan, path) => plan.files.find((entry) => entry.path === path)?.content;
    assert.notEqual(projects[0].projectId, projects[1].projectId);
    for (const project of projects) {
      assert(get(project, 'docs/ENGINEERING_PROFILE.md').includes(profile.advice.Testing));
      assert(get(project, '.factory/engineering.json').includes(template.id));
    }
    assert.notEqual(get(projects[0], '.factory/engineering.json'), get(projects[1], '.factory/engineering.json'));
    const revised = await author.library.publish({ ...profile, advice: { Testing: 'Run regression checks before review.' } });
    assert(revised.ok && revised.value.version === 2);
    const secondBundle = await author.delivery.export({ projectId: first, assets: [{ id: profile.id, version: 2 }] });
    assert(secondBundle.ok && secondBundle.value);
    services.commit(publisher, 'Share engineering profile v2');
    exec(services.gitBin, ['merge', '--ff-only', 'main'], consumer, process.env, 'pipe');
    assert.deepEqual(await reader.delivery.import({ projectId: second, digest: secondBundle.value.digest }), { ok: true, value: 1 });
    assert(get(projects[0], 'docs/ENGINEERING_PROFILE.md').includes(profile.advice.Testing));
    const sharedPath = join(consumer, 'factory-library', shared.value.digest + '.json');
    await writeFile(sharedPath, '{}\n');
    assert.equal((await reader.delivery.import({ projectId: second, digest: shared.value.digest })).ok, false);
    console.log('Shared profile and template passed across two native Git worktrees, with version locks and corruption rejection.');
    return { ...fromReader };
  } finally {
    await author.developer.dispose();
    await reader.developer.dispose();
    await services.git.dispose();
    await rm(parent, { recursive: true, force: true, maxRetries: 5 });
  }
}

export async function applyDeliveryFixture(vite, directory) {
  const { composeDelivery, readIncrementalProject, incrementalPaths, sha256 } = await vite.ssrLoadModule('/packages/generator/src/index.ts');
  const { admitRoot } = await vite.ssrLoadModule('/apps/desktop/src/main/services/projects/filesystem.ts');
  const { inspectFile } = await vite.ssrLoadModule('/apps/desktop/src/main/services/incremental/files.ts');
  const root = await admitRoot(directory);
  const files = new Map(await Promise.all(incrementalPaths.map(async (path) => [path, await inspectFile(root, path)])));
  for (const type of ['ci', 'docker']) {
    const versioned = readIncrementalProject(files);
    const reviewed = composeDelivery(versioned, files, type);
    assert.deepEqual(reviewed.issues, []);
    assert(reviewed.changes.length > 1);
    for (const { path, after, action } of reviewed.changes) {
      assert(after);
      await mkdir(dirname(join(root.path, path)), { recursive: true });
      await writeFile(join(root.path, path), after, { flag: action === 'create' ? 'wx' : 'w' });
      files.set(path, { state: 'text', content: after, sha256: sha256(after) });
    }
    assert.deepEqual(composeDelivery(readIncrementalProject(files), files, type).changes, []);
  }
  const workflow = await readFile(join(directory, '.github/workflows/factory-verification.yml'), 'utf8');
  assert(workflow.includes('permissions:\n  contents: read') && workflow.includes('persist-credentials: false'));
  assert(!workflow.includes('pull_request_target'));
}

async function verifyDocker(directory, go, env) {
  const prefix = ['compose', '-p', 'factory-' + randomUUID().slice(0, 8), '-f', 'compose.factory.yaml'];
  const dockerEnv = { ...env, DATABASE_URL: 'postgresql://factory_dev:disposable-delivery-fixture@database:5432/factory_dev',
    POSTGRES_PASSWORD: 'disposable-delivery-fixture' };
  const command = (...args) => exec('docker', [...prefix, ...args], directory, dockerEnv);
  try {
    command('build');
    command('up', '-d', '--wait', 'database');
    command('run', '--rm', 'app', ...(go ? ['/app/migrate'] : ['node', 'dist/server/migrate.js']));
    command('up', '-d', '--wait', 'app');
    await localhostReady(null, 'http://127.0.0.1:3000/api/health');
    await localhostReady(null, 'http://127.0.0.1:3000/api/ready');
    console.log('Container build, non-published PostgreSQL, explicit migrations, health and readiness verified.');
  } finally { command('down', '-v'); }
}

export async function verifyDelivery(vite, directory, env, go, packageManager, port) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'studio-release-')));
  const profile = join(parent, 'profile');
  const install = join(parent, 'independent client');
  const id = randomUUID();
  const grants = new Map();
  await Promise.all([mkdir(profile), mkdir(install)]);
  const services = await fixtureServices(vite, parent, grants);
  const { developer, delivery } = services.create(profile, parent);
  let child;
  try {
    const root = await services.admitRoot(directory);
    grants.set(id, root);
    if (!go && env.TEST_DATABASE_URL) {
      await writeFile(join(root.path, '.env'), 'TEST_DATABASE_URL=' + env.TEST_DATABASE_URL + '\n', { flag: 'wx', mode: 0o600 });
    }
    exec(services.gitBin, ['init', '-b', 'main'], root.path, process.env, 'pipe');
    services.commit(root.path, 'Pin reviewed client release');
    const writable = await delivery.inspect(id);
    assert(writable.ok && writable.value.clean && writable.value.source);
    const source = writable.value.source;
    const taskList = go ? ['lint', 'typecheck', 'format', 'vet', 'test', 'build'] : ['lint', 'typecheck', 'test', 'build'];
    if (!go && env.TEST_DATABASE_URL) taskList.push('postgres');
    if (process.env.FACTORY_DELIVERY_AUDIT === '1') taskList.push('audit');
    async function quality(task) {
      const review = await developer.preview({ projectId: id, task, quality: true, frontendPort: 5173 });
      assert(review.ok, task + ' preview ' + JSON.stringify(review));
      const started = await developer.start({ projectId: id, id: review.value.id });
      assert(started.ok, task + ' approval ' + JSON.stringify(started));
      for (let attempt = 0; attempt < 620; attempt++) {
        const logs = await developer.logs(id);
        assert(logs.ok);
        const log = logs.value.find((entry) => entry.process.id === started.value.id);
        if (log?.process.state === 'failed') throw new Error(task + ' failed: ' + JSON.stringify(log.lines));
        if (log?.process.state === 'completed') return;
        await delay(180);
      }
      throw new Error(task + ' did not finish.');
    }
    assert.deepEqual(await delivery.package({ projectId: id, version: '1.0.0', notes: '', source }), { ok: false, error: 'DELIVERY_BLOCKED' });
    for (const task of taskList) await quality(task);
    const inspection = await delivery.inspect(id);
    assert(inspection.ok);
    assert.deepEqual(new Set(inspection.value.quality.filter((row) => row.outcome === 'passed').map(({ task }) => task)), new Set(taskList));
    const input = { projectId: id, version: '1.0.0', notes: 'First client handoff.', source };
    const result = await delivery.package(input);
    assert(result.ok && result.value, JSON.stringify(result));
    const artifact = result.value.file;
    assert.equal(createHash('sha256').update(await readFile(artifact)).digest('hex'), result.value.sha256);
    const live = await delivery.inspect(id);
    assert(live.ok && live.value.releases[0]?.artifact === 'available');
    exec('tar', ['-xf', artifact], install, process.env);
    const evidence = JSON.parse(await readFile(join(install, 'release-evidence.json'), 'utf8'));
    assert.equal(evidence.revision, result.value.head);
    assert(evidence.files.every(({ path }) => !/\.env|\.npmrc|^\.git|node_modules/u.test(path)));
    if (!go) exec(process.execPath, [packageManager, 'install', '--prod', '--frozen-lockfile', '--ignore-scripts'], install, env);
    const executable = go ? join(install, 'dist', process.platform === 'win32' ? 'factory-server.exe' : 'factory-server') : process.execPath;
    child = spawn(executable, go ? [] : ['dist/server/server.js'],
      { cwd: install, env: { ...env, HOST: '127.0.0.1', PORT: String(port) }, stdio: 'ignore', windowsHide: true });
    await localhostReady(child, 'http://127.0.0.1:' + port + '/api/health');
    await localhostReady(child, 'http://127.0.0.1:' + port + '/api/ready', env.DATABASE_URL ? 200 : 503);
    const exited = new Promise((done) => child.once('exit', done));
    child.kill();
    await exited;
    child = undefined;
    if (process.env.FACTORY_DOCKER_VERIFY === '1') await verifyDocker(root.path, go, env);
    await rm(artifact);
    const missing = await delivery.inspect(id);
    assert(missing.ok && missing.value.releases[0]?.artifact === 'missing');
    const resumed = await delivery.package(input);
    assert(resumed.ok && resumed.value?.sha256 === result.value.sha256);
    const modified = join(root.path, 'README.md');
    await writeFile(modified, await readFile(modified, 'utf8') + '\nLocal change after verification.\n');
    assert.deepEqual(await delivery.package({ ...input, version: '1.0.1' }), { ok: false, error: 'DELIVERY_STALE' });
    console.log('Client archive verified independently: ' + (go ? 'Go executable and assets' : 'Node.js production dependencies and assets'));
  } finally {
    if (child?.exitCode === null) child.kill();
    await developer.dispose();
    await services.git.dispose();
    await rm(parent, { recursive: true, force: true, maxRetries: 5 });
  }
}
