import { parseSql } from '@factory/schema';
import { describe, expect, it } from 'vitest';
import { AUTHENTICATION, GO_STACK, STACKS, isGeneratorPath, isStarterConfig, moduleCompatibility, STARTER, WELCOME_EXAMPLE } from '@factory/contracts';
import type { StarterConfig } from '@factory/contracts';
import { planLegacyProject, planProject, sha256 } from './index';

const id = 'c9003316-9dd8-4750-a358-0949873a010e';
const config: StarterConfig = {
  name: 'Client café', slug: 'client-cafe', port: 4108,
  appType: STARTER.appType, stack: STARTER.stack, database: STARTER.database, modules: [], architecture: STARTER.architecture, engineering: STARTER.engineering,
};

describe('built-in starter plans', () => {
  it('renders reproducible bytes, metadata, toolchain locks, and file fingerprints', () => {
    const one = planProject(config, id);
    const two = planProject({ ...config, port: 4108 }, id);
    expect(one).toEqual(two);
    const paths = Object.fromEntries(one.files.map((file) => [file.path, file]));
    expect(paths['AGENTS.md']?.content).toContain('# Client café');
    expect(paths['web/main.tsx']?.content).toContain('{"Client café"}');
    expect(paths['.env.example']?.content).toContain('PORT=4108');
    expect(paths['pnpm-lock.yaml']?.content).toContain('lockfileVersion:');
    expect(JSON.parse(paths['.factory/project.json']!.content)).toMatchObject({ id, name: config.name, stackId: STARTER.stack });
    const manifest = JSON.parse(paths['.factory/generation-manifest.json']!.content) as {
      files: { path: string; sha256: string }[];
    };
    expect(manifest.files).toHaveLength(one.files.length - 1);
    for (const file of manifest.files) expect(file.sha256).toBe(sha256(paths[file.path]!.content));
    expect(planProject({ ...config, port: 4109 }, id).digest).not.toBe(one.digest);
  });

  it('rejects unsupported profiles, unsafe names, reserved folders, and ambiguous paths', () => {
    for (const changes of [{ slug: '../outside' }, { slug: 'nul' }, { slug: 'A-Path' }, { name: '<script>' },
      { port: 22 }, { stack: 'future' }, { extra: 'field' }]) {
      expect(isStarterConfig({ ...config, ...changes })).toBe(false);
    }
    for (const path of ['../outside', 'x/../outside', 'x/CON.log', '/etc', '.git/config', 'x:a', 'web\\outside']) {
      expect(isGeneratorPath(path)).toBe(false);
    }
  });
});

it('generates only selected module files, routes, tests and instructions', () => {
  const lean = planProject(config, id);
  const demo = planProject({ ...config, modules: [WELCOME_EXAMPLE] }, id);
  const source = (plan: typeof lean, path: string) => plan.files.find((file) => file.path === path)?.content;
  expect(lean.digest).not.toBe(demo.digest);
  expect(source(lean, 'db/migrations/0001_baseline.sql')).toContain('schema_migrations');
  expect(source(lean, 'server/routes.ts')).toContain("router.get('/ready'");
  for (const path of ['server/features/welcome/register.ts', 'web/features/Welcome.tsx', 'db/migrations/0002_welcome.sql', 'test/welcome.test.ts']) {
    expect(source(lean, path)).toBeUndefined();
    expect(source(demo, path)).toBeDefined();
  }
  expect(source(lean, 'AGENTS.md')).not.toContain('Welcome example');
  expect(source(demo, 'AGENTS.md')).toContain('optional Welcome example');
  expect(source(lean, 'package.json')).not.toContain('test/welcome.test.ts');
  expect(source(demo, 'package.json')).toContain('test/welcome.test.ts');
  expect(source(demo, 'pnpm-lock.yaml')).toBe(source(lean, 'pnpm-lock.yaml'));
  expect(JSON.parse(source(lean, '.factory/modules.json')!)).toEqual({ version: 1, installed: [] });
  expect(JSON.parse(source(demo, '.factory/modules.json')!)).toMatchObject({ installed: [{
    ...WELCOME_EXAMPLE, requires: [], templateSha256: expect.stringMatching(/^[a-f\d]{64}$/u),
  }] });
  expect(JSON.parse(source(demo, '.factory/generation-manifest.json')!).files).toContainEqual({
    path: 'test/welcome.test.ts', action: 'create', owner: 'welcome-example', sha256: expect.any(String),
  });
});

it('rejects unavailable project types, planned modules, missing dependencies and wrong module versions', () => {
  for (const input of [
    { ...config, modules: [WELCOME_EXAMPLE, WELCOME_EXAMPLE] },
    { ...config, modules: [{ ...WELCOME_EXAMPLE, version: '2.0.0' }] },
    { ...config, modules: [{ id: 'authentication', version: '9.0.0' }] },
    { ...config, modules: [{ id: 'custom', version: '1.0.0' }] },
    { ...config, modules: [{ ...WELCOME_EXAMPLE, source: '../template' }] },
    { ...config, appType: 'frontend-only' },
    { ...config, database: 'none' },
  ]) expect(isStarterConfig(input)).toBe(false);
  expect(moduleCompatibility('full-stack', 'postgresql', [{ id: 'rbac', version: '1.0.0' }])).toEqual([
    'RBAC requires authentication.', 'RBAC requires user-management.',
  ]);
  expect(moduleCompatibility('backend-only', 'none', [WELCOME_EXAMPLE])).toEqual([
    'Welcome example is incompatible with the selected application type or database.',
  ]);
});

it('reproduces the previously released v1 plan byte for byte for recovery only', () => {
  const legacy = {
    name: 'Inventory Portal', slug: 'inventory-portal', port: 3000, appType: STARTER.appType,
    stack: STARTER.stack, architecture: STARTER.architecture, engineering: STARTER.engineering,
  };
  expect(isStarterConfig(legacy)).toBe(false);
  expect(planLegacyProject(legacy, '92500fcd-63be-4e81-b0dd-918e935ab0d3').digest)
    .toBe('7cb9f1e960819c4c1cc1889323831176cd08b30b10746bed3391fa44cc893f03');
});

it('locks the explicit schema and generates only compatible selected CRUD layers', () => {
  const { schema, diagnostics } = parseSql('CREATE TABLE products (id integer PRIMARY KEY, name text NOT NULL);');
  expect(diagnostics).toEqual([]);
  const migrationOnly = planProject({ ...config, crud: { schema, migrations: true, backend: [], frontend: [] } }, id);
  expect(migrationOnly.files.some(({ path }) => path === 'db/migrations/0002_schema.sql')).toBe(true);
  expect(migrationOnly.files.some(({ path }) => path.includes('/crud/'))).toBe(false);
  const api = { schema, migrations: true as const, backend: ['products'], frontend: [] };
  const backendOnly = planProject({ ...config, crud: api }, id);
  expect(backendOnly.files.some(({ path }) => path === 'server/features/crud/register.ts')).toBe(true);
  expect(backendOnly.files.some(({ path }) => path.includes('web/features/crud'))).toBe(false);
  const full = planProject({ ...config, crud: { ...api, frontend: ['products'] }, modules: [WELCOME_EXAMPLE] }, id);
  const manifest = full.files.find(({ path }) => path === '.factory/generation-manifest.json')!;
  expect(JSON.parse(manifest.content)).toMatchObject({
    versions: { schema: { version: '1.0.0', migration: 'db/migrations/0003_schema.sql', backend: ['products'], frontend: ['products'] } },
    files: expect.arrayContaining([expect.objectContaining({ path: 'web/features/crud/Crud.tsx', owner: 'postgresql-crud', action: 'create' })]),
  });
  expect(full.files.find(({ path }) => path === 'pnpm-lock.yaml')).toEqual(migrationOnly.files.find(({ path }) => path === 'pnpm-lock.yaml'));
  expect(() => planProject({ ...config, crud: { ...api, backend: [], frontend: ['products'] } }, id)).toThrow(/requires the generated API/u);
});

it('resolves the exact Go adapter with its own locks and rejects cross-stack configurations', () => {
  const input = { ...config, stack: GO_STACK, architecture: STACKS[GO_STACK].architecture };
  const plan = planProject(input, id);
  expect(plan).toEqual(planProject(input, id));
  const contents = new Map(plan.files.map(({ path, content }) => [path, content]));
  expect(contents.get('go.mod')).toContain('module example.com/factory/client-cafe');
  expect(contents.get('go.mod')).toContain('go 1.26.11');
  expect(contents.get('go.sum')).toContain('github.com/gin-gonic/gin v1.12.0');
  expect(contents.get('package.json')).not.toContain('"express"');
  expect(contents.get('server/app.ts')).toBeUndefined();
  expect(JSON.parse(contents.get('.factory/versions.lock.json')!).stack).toMatchObject({ id: GO_STACK, version: '1.0.0', sdk: 1 });
  expect(isStarterConfig({ ...input, architecture: STARTER.architecture })).toBe(false);
  expect(isStarterConfig({ ...input, modules: [AUTHENTICATION] })).toBe(false);
});
