import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { STARTER } from '@factory/contracts';
import type { IncrementalSelection, Result } from '@factory/contracts';
import { planProject } from '@factory/generator';
import { parseSql } from '@factory/schema';
import { admitRoot } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { GitStudio } from '../git/studio';
import { IncrementalStudio } from './studio';
import { IncrementalStore } from './storage';

const projectId = '45fefba2-ce17-4da2-a740-8aa30cef4fd8';
const ddl = await readFile(new URL('../../../../../../tests/fixtures/suppliers.sql', import.meta.url), 'utf8');
const inventory = parseSql('CREATE TABLE products (id integer PRIMARY KEY, name text NOT NULL);').schema;
let fixture: string;
let root: ProjectRoot;
let profile: string;
let git: GitStudio;
let studio: IncrementalStudio;
let active: boolean;
let confirm: () => Promise<boolean>;
let schemaPending: () => Promise<boolean>;

function makeStudio() {
  return new IncrementalStudio(new IncrementalStore(profile), {
    root: (id) => active && id === projectId ? root : undefined,
    project: async () => undefined,
    git: (id) => git.status(id), gitWriting: () => false, schemaPending: () => schemaPending(),
    refresh: async () => undefined,
  }, { confirm: () => confirm() });
}
function value<T>(result: Result<T>) {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}
async function put(path: string, data: string) {
  const target = join(root.path, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data, 'utf8');
}
const get = (path: string) => readFile(join(root.path, path), 'utf8');
const request = (revision: string): IncrementalSelection => ({ projectId, revision, backend: ['suppliers'], frontend: ['suppliers'] });
const nativeGit = (...args: string[]) => execFileSync('git', args, { cwd: root.path, stdio: 'ignore' });

async function fixtureProject(withCrud = true) {
  const plan = planProject({
    name: 'Inventory reference', slug: 'inventory-reference', port: 4202, appType: STARTER.appType,
    stack: STARTER.stack, architecture: STARTER.architecture, engineering: STARTER.engineering, database: STARTER.database,
    modules: [],
    ...(withCrud ? { crud: { schema: inventory, migrations: true, backend: ['products'], frontend: ['products'] } } : {}),
  }, projectId);
  for (const file of plan.files) await put(file.path, file.content);
  if (!withCrud) await put('db/migrations/0002_products.sql', 'CREATE TABLE products (id integer PRIMARY KEY, name text NOT NULL);\n');
  return plan;
}

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'factory-incremental-'));
  const project = join(fixture, 'projekt café');
  profile = join(fixture, 'profile');
  await Promise.all([mkdir(project), mkdir(profile)]);
  root = await admitRoot(project);
  active = true;
  confirm = async () => true;
  schemaPending = async () => false;
  git = new GitStudio({
    root: (id) => active && id === projectId ? root : undefined,
    canOpen: () => false, allowsAuxiliaryPath: () => true, adopt: async () => { throw new Error('Unexpected adoption.'); },
    refresh: async () => undefined, generationPending: (path) => studio.protectsGit(path),
  }, { chooseDirectory: async () => null, confirm: async () => true });
  studio = makeStudio();
});

afterEach(async () => {
  studio.dispose();
  await git.dispose();
  await rm(fixture, { recursive: true, force: true, maxRetries: 4 });
});

it('extends an existing generated CRUD app from an external migration and is idempotent', async () => {
  await fixtureProject();
  const custom = (await get('server/features/crud/service.ts')) + '\n// Client-specific service notes.\n';
  await put('server/features/crud/service.ts', custom);
  const agent = (await get('AGENTS.md')) + '\n## Client instructions\nPreserve the existing audit workload.\n';
  await put('AGENTS.md', agent);
  await put('db/migrations/0003_suppliers.sql', ddl);
  const inspect = value(await studio.inspect(projectId));
  expect(inspect.issues).toEqual([]);
  expect(inspect.files.find(({ path }) => path === 'server/features/crud/service.ts')?.state).toBe('modified');
  expect(inspect.sources.at(-1)).toMatchObject({ name: '0003_suppliers.sql', external: true });
  const plan = value(await studio.preview(request(inspect.revision)));
  expect(plan.issues).toEqual([]);
  expect(plan.changes).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: 'server/features/crud/contracts.ts', action: 'modify', after: expect.stringContaining('Row_suppliers') }),
    expect.objectContaining({ path: 'server/features/crud/service.ts', action: 'protected' }),
  ]));
  expect(plan.changes.some(({ path }) => path.startsWith('db/'))).toBe(false);
  const applied = value(await studio.action({ projectId, id: plan.id }, 'apply'));
  expect(applied?.history[0]).toMatchObject({ outcome: 'applied', digest: plan.digest });
  expect(applied?.issues).toEqual([]);
  expect(await get('server/features/crud/service.ts')).toBe(custom);
  expect(await get('AGENTS.md')).toBe(agent);
  expect(await get('db/migrations/0003_suppliers.sql')).toBe(ddl);
  expect(await get('docs/DATABASE_SCHEMA.md')).toContain('0003_suppliers.sql');
  const repeat = value(await studio.preview(request(applied!.revision)));
  expect(repeat.issues).toEqual([]);
  expect(repeat.changes.filter(({ action }) => action === 'create' || action === 'modify')).toEqual([]);
}, 40_000);

it('blocks a customized required entrypoint, missing generated code, unauthorized paths and junctions', async () => {
  await fixtureProject(false);
  await put('db/migrations/0003_suppliers.sql', ddl);
  const routes = await get('server/routes.ts');
  await put('server/routes.ts', routes + '// Custom routes.\n');
  const read = async () => value(await studio.inspect(projectId));
  let plan = value(await studio.preview(request((await read()).revision)));
  expect(plan.changes.find(({ path }) => path === 'server/routes.ts')?.action).toBe('conflict');
  expect(await studio.action({ projectId, id: plan.id }, 'apply')).toEqual({ ok: false, error: 'INCREMENTAL_CONFLICT' });
  await put('server/routes.ts', routes);
  await rm(join(root.path, 'web/main.tsx'));
  const missing = await read();
  expect(missing.files.find(({ path }) => path === 'web/main.tsx')?.state).toBe('missing');
  plan = value(await studio.preview(request(missing.revision)));
  expect(plan.changes.find(({ path }) => path === 'web/main.tsx')?.action).toBe('conflict');
  const startup = await fixtureProject(false);
  expect(startup.files.length).toBeGreaterThan(25);
  const outside = join(fixture, 'outside');
  await mkdir(outside);
  await symlink(outside, join(root.path, 'web', 'features'), process.platform === 'win32' ? 'junction' : 'dir');
  plan = value(await studio.preview(request((await read()).revision)));
  expect(plan.changes.some(({ path, action }) => path === 'web/features/crud/Crud.tsx' && action === 'conflict')).toBe(true);
  expect(await readdir(outside)).toEqual([]);
  active = false;
  expect(await studio.action({ projectId, id: plan.id }, 'apply')).toEqual({ ok: false, error: 'ACCESS_DENIED' });
}, 40_000);

it('rejects Git branch and migration changes after review', async () => {
  await fixtureProject(false);
  await put('db/migrations/0003_suppliers.sql', ddl);
  nativeGit('init', '-b', 'main');
  nativeGit('add', '.');
  nativeGit('-c', 'user.name=Factory Tests', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture');
  const state = value(await studio.inspect(projectId));
  expect(state.branch).toBe('main');
  const plan = value(await studio.preview(request(state.revision)));
  confirm = async () => { nativeGit('checkout', '-b', 'topic'); return true; };
  expect(await studio.action({ projectId, id: plan.id }, 'apply')).toEqual({ ok: false, error: 'INCREMENTAL_STALE' });
  const next = value(await studio.preview(request(value(await studio.inspect(projectId)).revision)));
  confirm = async () => { await put('db/migrations/0003_suppliers.sql', ddl + '\n-- external edit\n'); return true; };
  expect(await studio.action({ projectId, id: next.id }, 'apply')).toEqual({ ok: false, error: 'INCREMENTAL_STALE' });
  await expect(get('server/features/crud/contracts.ts')).rejects.toMatchObject({ code: 'ENOENT' });
}, 40_000);

it('resumes a durable backup checkpoint and preserves an intervening conflicting edit', async () => {
  await fixtureProject(false);
  await put('db/migrations/0003_suppliers.sql', ddl);
  const state = value(await studio.inspect(projectId));
  const plan = value(await studio.preview(request(state.revision)));
  const routes = await get('server/routes.ts');
  schemaPending = async () => (await readdir(join(root.path, 'server'))).some((name) => name.startsWith('.factory-incremental-backup-'));
  expect(await studio.action({ projectId, id: plan.id }, 'apply')).toEqual({ ok: false, error: 'GENERATOR_RECOVERY' });
  expect(await studio.protectsGit(root.path)).toBe(true);
  studio.dispose();
  studio = makeStudio();
  expect(value(await studio.inspect(projectId)).recovery?.digest).toBe(plan.digest);
  schemaPending = async () => false;
  await put('server/routes.ts', routes + '// This arrived after the checkpoint.\n');
  expect(await studio.action({ projectId, id: plan.id }, 'resume')).toEqual({ ok: false, error: 'GENERATOR_RECOVERY' });
  expect(await get('server/routes.ts')).toContain('after the checkpoint');
  await rm(join(root.path, 'server/routes.ts'));
  const recovered = value(await studio.action({ projectId, id: plan.id }, 'resume'));
  expect(recovered?.recovery).toBeNull();
  expect(recovered?.history[0]?.outcome).toBe('applied');
  expect(await get('server/routes.ts')).toContain('registerCrud');
  expect(await studio.protectsGit(root.path)).toBe(false);
}, 40_000);

it('hands off interrupted recovery without touching bytes in the workspace', async () => {
  await fixtureProject(false);
  await put('db/migrations/0003_suppliers.sql', ddl);
  const plan = value(await studio.preview(request(value(await studio.inspect(projectId)).revision)));
  const route = await get('server/routes.ts');
  schemaPending = async () => (await readdir(join(root.path, 'server'))).some((name) => name.startsWith('.factory-incremental-backup-'));
  expect(await studio.action({ projectId, id: plan.id }, 'apply')).toEqual({ ok: false, error: 'GENERATOR_RECOVERY' });
  const paths = await readdir(join(root.path, 'server'));
  const backup = paths.find((name) => name.startsWith('.factory-incremental-backup-'));
  expect(backup).toBeDefined();
  const moved = join(fixture, 'relocated project');
  await rename(root.path, moved);
  root = await admitRoot(moved);
  expect(value(await studio.inspect(projectId)).recovery?.digest).toBe(plan.digest);
  expect(await studio.action({ projectId, id: plan.id }, 'resume')).toEqual({ ok: false, error: 'INCREMENTAL_STALE' });
  confirm = async () => false;
  expect(value(await studio.action({ projectId, id: plan.id }, 'handoff'))).toBeNull();
  expect(await studio.protectsGit(root.path)).toBe(true);
  confirm = async () => true;
  const result = value(await studio.action({ projectId, id: plan.id }, 'handoff'));
  expect(result?.history[0]?.outcome).toBe('handed-off');
  expect(await readdir(join(root.path, 'server'))).toEqual(paths);
  expect(await get('server/' + backup)).toBe(route);
  expect(await studio.protectsGit(root.path)).toBe(false);
}, 40_000);
