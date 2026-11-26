import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { STARTER, success } from '@factory/contracts';
import type { GitState, Result, SchemaConnection } from '@factory/contracts';
import { parseSql, planMigration } from '@factory/schema';
import { GitStudio } from '../git/studio';
import { admitRoot } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { SchemaStore } from './storage';
import { DatabaseStudio } from './studio';

const projectId = 'f14e5956-cf20-45f0-956e-e398588b9f20';
const ddl = await readFile(new URL('../../../../../../tests/fixtures/inventory.sql', import.meta.url), 'utf8');
const schema = parseSql(ddl).schema;
const baseline = new URL('../../../../../../packages/generator/templates/modular/foundation/db/migrations/0001_baseline.sql', import.meta.url);
let directory: string;
let root: ProjectRoot;
let migrations: string;
let data: string;
let active: boolean;
let writing: boolean;
let git: GitState;
let confirm: (title: string, detail: string, action: string) => Promise<boolean>;
let studio: DatabaseStudio;

function makeStudio() {
  return new DatabaseStudio(new SchemaStore(data), {
    root: (id) => id === projectId && active ? root : undefined,
    git: async () => success(git),
    gitWriting: () => writing,
    refresh: async () => undefined,
  }, { confirm: (...args) => confirm(...args) });
}

function value<T>(result: Result<T>) {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'studio-schema-test-'));
  const project = join(directory, 'project');
  data = join(directory, 'profile');
  migrations = join(project, 'db', 'migrations');
  await Promise.all([mkdir(join(project, '.factory'), { recursive: true }), mkdir(migrations, { recursive: true }), mkdir(data)]);
  await writeFile(join(project, '.factory', 'project.json'), JSON.stringify({
    version: 1, id: projectId, stackId: STARTER.stack, profileId: STARTER.architecture,
  }));
  await copyFile(baseline, join(migrations, '0001_baseline.sql'));
  root = await admitRoot(project);
  git = { state: 'not-repository', detail: 'Fixture' };
  active = true;
  writing = false;
  confirm = async () => true;
  studio = makeStudio();
});

afterEach(async () => {
  studio.dispose();
  await rm(directory, { recursive: true, force: true, maxRetries: 4 });
});

it('publishes an append-only migration, verifies fingerprints and keeps ERD layout local', async () => {
  const before = value(await studio.inspect(projectId));
  const review = value(await studio.preview({ projectId, revision: before.revision, schema }));
  expect(review.migration?.name).toBe('0002_schema.sql');
  let consent = false;
  confirm = async (_, detail) => {
    expect(detail).toContain(review.migration?.sha256);
    return consent;
  };
  const request = { projectId, revision: before.revision, id: review.id };
  expect(value(await studio.publish(request))).toBeNull();
  consent = true;
  const published = value(await studio.publish(request));
  expect(published?.schema).toEqual(schema);
  expect(published?.migrations[1]).toEqual(review.migration);
  expect(await readFile(join(migrations, '0001_baseline.sql'), 'utf8')).toBe(await readFile(baseline, 'utf8'));
  expect(await readFile(join(migrations, '0002_schema.sql'), 'utf8')).toBe(review.migration?.sql);
  const points = [{ table: 'categories', x: 110, y: 50 }];
  expect(value(await studio.layout({ projectId, revision: published!.revision, points }))).toEqual(points);
  expect(value(await makeStudio().inspect(projectId)).layout).toEqual(points);
  active = false;
  expect(await studio.inspect(projectId)).toEqual({ ok: false, error: 'ACCESS_DENIED' });
});

it('requires a fresh plan on Git changes, modified history or a closed grant', async () => {
  const state = value(await studio.inspect(projectId));
  const review = value(await studio.preview({ projectId, revision: state.revision, schema }));
  confirm = async () => {
    await writeFile(join(migrations, '0001_baseline.sql'), '-- external source edit\n');
    return true;
  };
  expect(await studio.publish({ projectId, revision: state.revision, id: review.id })).toEqual({ ok: false, error: 'SCHEMA_STALE' });
  await expect(readFile(join(migrations, '0002_schema.sql'))).rejects.toMatchObject({ code: 'ENOENT' });
  const updated = value(await studio.inspect(projectId));
  expect(updated.revision).not.toBe(state.revision);
  writing = true;
  expect(await studio.preview({ projectId, revision: updated.revision, schema })).toEqual({ ok: false, error: 'PROJECT_BUSY' });
  writing = false;
  git = {
    state: 'repository', revision: 'b'.repeat(64), root: root.path, branch: 'topic', head: 'c'.repeat(40), operation: null,
    changes: [], branches: [], remotes: [], upstream: null, upstreamRemote: null, ahead: null, behind: null,
  };
  expect(await studio.preview({ projectId, revision: updated.revision, schema })).toEqual({ ok: false, error: 'SCHEMA_STALE' });
});

it('refuses symlinked migrations and directory junctions without touching the outside target', async () => {
  const outside = join(directory, 'outside');
  await mkdir(outside);
  await writeFile(join(outside, '0002_schema.sql'), 'outside content');
  const source = join(migrations, '0002_schema.sql');
  if (process.platform !== 'win32') {
    await symlink(join(outside, '0002_schema.sql'), source, 'file');
    expect(value(await studio.inspect(projectId)).diagnostics[0]?.message).toContain('regular file');
  }
  await rm(migrations, { recursive: true });
  await symlink(outside, migrations, process.platform === 'win32' ? 'junction' : 'dir');
  expect(await studio.inspect(projectId)).toEqual({ ok: false, error: 'SCHEMA_UNAVAILABLE' });
  expect(await readFile(join(outside, '0002_schema.sql'), 'utf8')).toBe('outside content');
});

it('recovers a blocked staged publication from durable local state without overwriting a conflict', async () => {
  const state = value(await studio.inspect(projectId));
  const preview = value(await studio.preview({ projectId, revision: state.revision, schema }));
  const stage = join(migrations, '.factory-stage-migration-' + preview.id);
  confirm = async () => {
    await writeFile(stage, 'externally created content');
    return true;
  };
  expect(await studio.publish({ projectId, revision: state.revision, id: preview.id })).toEqual({ ok: false, error: 'GENERATOR_RECOVERY' });
  expect(await readFile(stage, 'utf8')).toBe('externally created content');
  expect(await studio.protectsGit(root.path)).toBe(true);
  studio.dispose();
  studio = makeStudio();
  const interrupted = value(await studio.inspect(projectId));
  expect(interrupted.recovery?.migration).toEqual(preview.migration);
  await rm(stage);
  confirm = async () => true;
  const resumed = value(await studio.publish({ projectId, revision: interrupted.revision, id: preview.id }));
  expect(resumed?.recovery).toBeNull();
  expect(resumed?.schema).toEqual(schema);
  expect(await studio.protectsGit(root.path)).toBe(false);
});

it.skipIf(!process.env.FACTORY_TEST_DATABASE_URL)('observes and applies real PostgreSQL migrations with ledger and drift safeguards', async () => {
  const url = new URL(process.env.FACTORY_TEST_DATABASE_URL!);
  if (url.hostname !== '127.0.0.1' || url.pathname !== '/factory_check') throw new Error('Use the disposable loopback factory_check database.');
  const namespace = 'studio_' + randomUUID().replaceAll('-', '');
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA ' + namespace);
    const state = value(await studio.inspect(projectId));
    const preview = value(await studio.preview({ projectId, revision: state.revision, schema }));
    const written = value(await studio.publish({ projectId, revision: state.revision, id: preview.id }))!;
    const connection: SchemaConnection = {
      projectId, revision: written.revision, namespace, host: '127.0.0.1', port: Number(url.port || 5432),
      database: 'factory_check', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    };
    const initial = value(await studio.physical(connection))!;
    expect(initial.diagnostics).toEqual([]);
    expect(initial.applied).toEqual([]);
    expect(initial.pending).toEqual(['0001_baseline.sql', '0002_schema.sql']);
    expect(initial.differences).toHaveLength(5);
    expect((await client.query('SELECT 1 FROM information_schema.tables WHERE table_schema = $1', [namespace])).rows).toEqual([]);
    const complete = value(await studio.physical(connection, true))!;
    expect(complete.schema).toEqual(schema);
    expect(complete.differences).toEqual([]);
    expect(complete.pending).toEqual([]);
    expect(complete.applied).toHaveLength(2);
    expect(complete.applied[1]?.sha256).toBe(preview.migration?.sha256);
    const types = parseSql(String.raw`
      CREATE TABLE type_probe (
        small smallint DEFAULT -25,
        large bigint DEFAULT -432,
        amount numeric DEFAULT 2.25 CHECK (amount >= 0.01),
        body text DEFAULT E'Back\\slash and O''Reilly',
        enabled boolean DEFAULT TRUE,
        local_day date DEFAULT '2026-11-26',
        begins timestamp DEFAULT '2026-11-26T10:30:25.125',
        ends timestamptz DEFAULT '2026-11-26T10:30:25.567891+07:00',
        code uuid DEFAULT '00112233-4455-6677-8899-AABBCCDDEEFF',
        payload jsonb DEFAULT '{}'
      );
    `, schema);
    expect(types.diagnostics).toEqual([]);
    const typePlan = value(await studio.preview({ projectId, revision: written.revision, schema: types.schema }));
    const typeFiles = value(await studio.publish({ projectId, revision: written.revision, id: typePlan.id }))!;
    const typeConnection = { ...connection, revision: typeFiles.revision };
    expect(value(await studio.physical(typeConnection))?.pending).toEqual(['0003_schema.sql']);
    const appliedTypes = value(await studio.physical(typeConnection, true))!;
    expect(appliedTypes.schema).toEqual(types.schema);
    expect(appliedTypes.pending).toEqual([]);
    await client.query('INSERT INTO ' + namespace + ".categories VALUES (1, 'Duplicate'), (2, 'Another')");
    const next = parseSql('ALTER TABLE categories ADD COLUMN code text DEFAULT \'same\'; ALTER TABLE categories ADD CONSTRAINT unique_code UNIQUE (code);', types.schema);
    const invalid = value(await studio.preview({ projectId, revision: typeFiles.revision, schema: next.schema }));
    const latest = value(await studio.publish({ projectId, revision: typeFiles.revision, id: invalid.id }))!;
    const updated = { ...connection, revision: latest.revision };
    expect(value(await studio.physical(updated))?.pending).toEqual(['0004_schema.sql']);
    expect(await studio.physical(updated, true)).toEqual({ ok: false, error: 'SCHEMA_DATABASE' });
    expect((await client.query('SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3', [namespace, 'categories', 'code'])).rows).toEqual([]);
    expect((await client.query('SELECT * FROM ' + namespace + '.schema_migrations')).rows).toHaveLength(3);
    await writeFile(join(migrations, '0001_baseline.sql'), '-- revised history\n');
    const edited = value(await studio.inspect(projectId));
    const drift = value(await studio.physical({ ...connection, revision: edited.revision }))!;
    expect(drift.pending).toBeNull();
    expect(drift.diagnostics[0]?.message).toContain('checksums');
  } finally {
    await client.query('DROP SCHEMA IF EXISTS ' + namespace + ' CASCADE');
    await client.end();
  }
}, 30_000);


it.skipIf(!process.env.FACTORY_TEST_DATABASE_URL)('refreshes checked-out schema sources while the physical database and ledger stay unchanged', { timeout: 45_000 }, async () => {
  const endpoint = new URL(process.env.FACTORY_TEST_DATABASE_URL!);
  if (endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/factory_check') throw new Error('Use the disposable loopback factory_check database.');
  const namespace = 'studio_git_' + randomUUID().replaceAll('-', '');
  const client = new pg.Client({ connectionString: endpoint.href });
  const native = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args],
    { cwd: root.path, stdio: 'ignore' });
  const service = new GitStudio({
    root: (id) => id === projectId ? root : undefined,
    canOpen: () => false, allowsAuxiliaryPath: () => true, adopt: async () => { throw new Error('Unrequested admission'); },
    refresh: async () => undefined, generationPending: (path) => studio.protectsGit(path),
  }, { chooseDirectory: async () => null, confirm: async () => true }, data);
  studio.dispose();
  studio = new DatabaseStudio(new SchemaStore(data), {
    root: (id) => id === projectId ? root : undefined,
    git: (id) => service.status(id), gitWriting: () => service.isWriting(), refresh: async () => undefined,
  }, { confirm: async () => true });
  await client.connect();
  try {
    await client.query('CREATE SCHEMA ' + namespace);
    native('init', '-b', 'main');
    native('add', '.');
    native('commit', '-m', 'Initial baseline');
    const version = value(await studio.inspect(projectId));
    const settings: SchemaConnection = {
      projectId, revision: version.revision, namespace, host: '127.0.0.1', port: Number(endpoint.port || 5432),
      database: 'factory_check', user: decodeURIComponent(endpoint.username), password: decodeURIComponent(endpoint.password),
    };
    expect(value(await studio.physical(settings))?.pending).toEqual(['0001_baseline.sql']);
    expect(value(await studio.physical(settings, true))?.applied).toHaveLength(1);
    native('switch', '-c', 'feature');
    const change = planMigration(version.schema, parseSql('CREATE TABLE branch_only (id integer PRIMARY KEY);').schema);
    expect(change.diagnostics).toEqual([]);
    await writeFile(join(migrations, '0002_feature.sql'), change.sql);
    native('add', '.');
    native('commit', '-m', 'Add reviewed feature SQL');
    native('switch', 'main');
    const state = value(await service.status(projectId));
    if (state.state !== 'repository') throw new Error('Expected a scoped Git checkout.');
    const reviewed = value(await service.advanced.review({ id: projectId, revision: state.revision, kind: 'switch', ref: 'refs/heads/feature' }));
    expect(reviewed?.ticket).toBeTruthy();
    expect(value(await service.advanced.apply({ id: projectId, ticket: reviewed!.ticket! })).level).toBe('success');
    const feature = value(await studio.inspect(projectId));
    expect(feature.schema.tables.map(({ name }) => name)).toContain('branch_only');
    expect(value(await studio.physical({ ...settings, revision: feature.revision }))?.pending).toEqual(['0002_feature.sql']);
    expect((await client.query('SELECT to_regclass($1) AS name', [namespace + '.branch_only'])).rows[0].name).toBeNull();
    expect((await client.query('SELECT name FROM ' + namespace + '.schema_migrations')).rows).toEqual([{ name: '0001_baseline.sql' }]);
  } finally {
    await service.dispose();
    await client.query('DROP SCHEMA IF EXISTS ' + namespace + ' CASCADE');
    await client.end();
  }
});
