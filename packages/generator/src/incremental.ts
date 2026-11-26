import {
  GENERATOR_LIMITS, GO_STACK, stackDefinition, AUTHENTICATION, IDENTITY_MODULES, MODULE_CATALOG, isLibrarySelection, moduleCompatibility, orderedModules, hasExactKeys, isGeneratorDigest, isGeneratorPath, isModuleSelection, isRecord, isSchemaName,
  isProjectId, isStarterName, isStarterPort, isStarterSlug, STARTER, WELCOME_EXAMPLE,
} from '@factory/contracts';
import type { DatabaseSchema, GeneratorFile, IncrementalChange, IncrementalOwnedFile, ModuleSelection, SchemaMigration, StarterConfig } from '@factory/contracts';
import { validateCrud } from '@factory/schema';
import { CRUD_OWNER } from './crud';
import { identityContributions, identityMigration, IDENTITY_PREFIX } from './identity';
import { planProject, sha256 } from './index';
import { goCrudPaths, goIntegrationPath } from './go';

const manifestPath = '.factory/generation-manifest.json';
const versionsPath = '.factory/versions.lock.json';
const modulePath = '.factory/modules.json';
const descriptorPath = '.factory/project.json';

const foundationPaths = [
  'server/routes.ts', 'web/main.tsx', 'package.json', 'AGENTS.md', 'README.md',
  'docs/ARCHITECTURE.md', 'docs/CODING_STANDARDS.md', 'docs/REQUIREMENTS.md',
];
const sharedFeatures = ['docs/DATABASE_SCHEMA.md', 'docs/CRUD_API.md', 'web/features/crud/Crud.tsx', 'web/features/crud/crud.css'];
const nodeFeatures = [
  'test/crud.test.ts', 'server/features/crud/contracts.ts', 'server/features/crud/validation.ts',
  'server/features/crud/repository.ts', 'server/features/crud/service.ts', 'server/features/crud/controller.ts', 'server/features/crud/register.ts',
];
const featurePaths = [...sharedFeatures, ...nodeFeatures];
const featuresFor = (stack: StarterConfig['stack']) => stack === GO_STACK ? [...sharedFeatures, ...goCrudPaths] : featurePaths;
const optionalContext = new Set(['AGENTS.md', 'README.md', 'docs/ARCHITECTURE.md', 'docs/CODING_STANDARDS.md', 'docs/REQUIREMENTS.md']);
const libraryPath = '.factory/engineering.json';
const identityFiles = [...new Set(identityContributions.flatMap(({ templates }) => templates.map(([path]) => path)))];
identityFiles.push('docs/IDENTITY.md', 'web/features/identity/Management.tsx');
const identityOwner = (path: string) => {
  const suffix = /^db\/migrations\/(?:\d{4})_([a-z_]+)\.sql$/u.exec(path)?.[1];
  return suffix && identityMigration(suffix) ? suffix.replaceAll('_', '-') : undefined;
};
export const incrementalPaths = [descriptorPath, manifestPath, versionsPath, modulePath, libraryPath, '.env.example',
  'server/app.ts', 'go.mod', goIntegrationPath, ...goCrudPaths, ...foundationPaths, ...featurePaths, ...identityFiles];
export const isModuleMigrationPath = (path: string) => Boolean(identityOwner(path));
export function isIncrementalWritePath(path: string) {
  return isModuleMigrationPath(path) || [...foundationPaths, ...featurePaths, goIntegrationPath, ...goCrudPaths, ...identityFiles, versionsPath, manifestPath, modulePath].includes(path);
}

export type LocalFile = { state: 'absent' | 'unsafe' } | { state: 'text'; sha256: string; content: string };
interface ManifestEntry { path: string; sha256: string; owner: string; action: 'create' }
interface VersionedProject {
  projectId: string; config: StarterConfig; files: ManifestEntry[]; versions: Record<string, unknown>;
  previous: { backend: string[]; frontend: string[]; migration: string | null; sources: { name: string; sha256: string }[] | null } | null;
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const keyed = (files: GeneratorFile[]) => new Map(files.map((file) => [file.path, file]));
const exact = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const ownerFor = (path: string, stack: StarterConfig['stack']) => featuresFor(stack).includes(path) ? CRUD_OWNER : stack;
const defaultReason = 'Previously generated content is current.';

export class IncrementalUnsupported extends Error {}

function requireProject<T>(value: T | false | null | undefined, reason: string): T {
  if (value === false || value == null) throw new IncrementalUnsupported(reason);
  return value;
}
function text(files: ReadonlyMap<string, LocalFile>, path: string): string | undefined {
  const file = files.get(path);
  return file?.state === 'text' ? file.content : undefined;
}
function object(input: string | undefined) {
  if (!input) return undefined;
  try { const value: unknown = JSON.parse(input); return isRecord(value) ? value : undefined; }
  catch { return undefined; }
}
function names(x: unknown): x is string[] {
  return Array.isArray(x) && x.length <= 32 && x.every(isSchemaName) && new Set(x).size === x.length;
}
export function manifestEntries(files: ReadonlyMap<string, LocalFile>) {
  const manifest = object(text(files, manifestPath));
  if (!manifest || !Array.isArray(manifest.files) || manifest.files.length > GENERATOR_LIMITS.files) return [];
  const entries: ManifestEntry[] = [];
  for (const item of manifest.files as unknown[]) {
    if (!isRecord(item) || !hasExactKeys(item, ['path', 'sha256', 'owner', 'action']) || !isGeneratorPath(item.path)
      || item.path === manifestPath || !isGeneratorDigest(item.sha256) || item.action !== 'create'
      || ![STARTER.stack, GO_STACK, CRUD_OWNER, ...MODULE_CATALOG.filter(({ version }) => version).map(({ id }) => id)].some((owner) => owner === item.owner)) return [];
    entries.push({ path: item.path, sha256: item.sha256, owner: item.owner as string, action: item.action });
  }
  return new Set(entries.map(({ path }) => path.toLowerCase())).size === entries.length ? entries : [];
}

export function readIncrementalProject(files: ReadonlyMap<string, LocalFile>): VersionedProject {
  const descriptor = requireProject(object(text(files, descriptorPath)), 'The portable project descriptor is unavailable.');
  const versionsFile = requireProject(object(text(files, versionsPath)), 'The stack version lock is unavailable.');
  const manifest = requireProject(object(text(files, manifestPath)), 'The generation manifest is unavailable.');
  const installed = requireProject(object(text(files, modulePath)), 'The module lock is unavailable.');
  const pkg = requireProject(object(text(files, 'package.json')), 'The package descriptor is unavailable.');
  const filesOwned = manifestEntries(files);
  const { id, name } = descriptor;
  const slug = pkg.name;
  const stack = stackDefinition(descriptor.stackId);
  const { version: lockVersion, ...versions } = versionsFile;
  if (descriptor.version !== 1 || descriptor.type !== STARTER.appType || !stack
    || descriptor.profileId !== stack.architecture || !isProjectId(id) || !isStarterName(name) || !isStarterSlug(slug)
    || manifest.version !== 2 || manifest.projectId !== id || !isGeneratorDigest(manifest.inputsSha256) || lockVersion !== 2
    || !filesOwned.length || !exact(manifest.versions, versions) || installed.version !== 1 || !exact(installed.installed, versions.modules)
    || !Array.isArray(versions.modules)) {
    throw new IncrementalUnsupported('This layout requires a consistent modular Phase 04 or Phase 05 generation manifest and version locks.');
  }
  const modules = versions.modules.map((value: unknown) => {
    if (!isRecord(value)) throw new IncrementalUnsupported('The module lock contains an unsupported entry.');
    const module = { id: value.id, version: value.version };
    if (!isModuleSelection(module)) throw new IncrementalUnsupported('The module is outside the pinned starter catalog.');
    return module;
  });
  const portValue = Number(/^PORT=(\d+)$/mu.exec(text(files, '.env.example') ?? '')?.[1]);
  const library = object(text(files, libraryPath));
  if ((versions.library !== undefined || library !== undefined) && !isLibrarySelection(library)) {
    throw new IncrementalUnsupported('The pinned engineering profile or template snapshot is missing or invalid.');
  }
  const config: StarterConfig = {
    name, slug, port: isStarterPort(portValue) ? portValue : 3000, appType: STARTER.appType, stack: stack.id,
    architecture: stack.architecture, engineering: STARTER.engineering, modules, database: STARTER.database, ...(isLibrarySelection(library) ? { library } : {}),
  };
  const pinned = keyed(planProject(config, id).files);
  const baseline = object(pinned.get(versionsPath)?.content)!;
  const known = new Map(manifestEntries(new Map([[manifestPath, { state: 'text', content: pinned.get(manifestPath)!.content,
    sha256: pinned.get(manifestPath)!.sha256 }]])).map(({ path, owner }) => [path, owner]));
  if (filesOwned.some(({ path, owner }) => owner === CRUD_OWNER
    ? !featuresFor(config.stack).includes(path) && path !== 'db/migrations/0002_schema.sql' && path !== 'db/migrations/0003_schema.sql'
    : known.get(path) !== owner && (identityOwner(path) !== owner || !modules.some(({ id }) => id === owner)))) {
    throw new IncrementalUnsupported('The manifest claims ownership of paths outside the pinned templates.');
  }
  const { schema: schemaLock, ...withoutSchema } = versions;
  if (!exact(baseline, { version: lockVersion, ...withoutSchema })) {
    throw new IncrementalUnsupported('The stack, engineering profiles or modules differ from the supported pinned templates.');
  }
  let previous: VersionedProject['previous'] = null;
  if (schemaLock !== undefined) {
    if (!isRecord(schemaLock) || schemaLock.id !== CRUD_OWNER || schemaLock.version !== '1.0.0'
      || !isGeneratorDigest(schemaLock.templateSha256) || !names(schemaLock.backend) || !names(schemaLock.frontend)
      || schemaLock.frontend.some((name) => !(schemaLock.backend as string[]).includes(name))) {
      throw new IncrementalUnsupported('The installed CRUD lock is unsupported.');
    }
    const migration = typeof schemaLock.migration === 'string' && /^db\/migrations\/\d{4}_[a-z0-9_]+\.sql$/u.test(schemaLock.migration) ? schemaLock.migration : null;
    const source = schemaLock.sources;
    if (source !== undefined && (!Array.isArray(source) || source.length > 128 || source.some((item: unknown) =>
      !isRecord(item) || typeof item.name !== 'string' || !/^\d{4}_[a-z0-9_]+\.sql$/u.test(item.name) || !isGeneratorDigest(item.sha256)))) {
      throw new IncrementalUnsupported('The generated source reference list is invalid.');
    }
    if (source === undefined && migration === null) throw new IncrementalUnsupported('The initial CRUD migration is missing from the lock.');
    previous = { backend: schemaLock.backend, frontend: schemaLock.frontend, migration, sources: (source as { name: string; sha256: string }[] | undefined) ?? null };
  }
  return { projectId: id, config, files: filesOwned, versions, previous };
}

export function classifyOwned(path: string, local: LocalFile | undefined, owned: ManifestEntry | undefined): IncrementalOwnedFile {
  if (local?.state === 'unsafe') return { path, state: 'protected', owner: owned?.owner ?? null };
  if (owned) {
    return { path, owner: owned.owner, state: local?.state !== 'text' ? 'missing' : local.sha256 === owned.sha256 ? 'generated' : 'modified' };
  }
  return { path, state: isIncrementalWritePath(path) ? 'user' : 'discovered', owner: null };
}

export function withoutWelcome(schema: DatabaseSchema, project: VersionedProject) {
  return { ...schema, tables: schema.tables.filter(({ name }) => !name.startsWith(IDENTITY_PREFIX) && (name !== 'welcome_messages' || !project.config.modules.some(({ id }) => id === WELCOME_EXAMPLE.id))) };
}

export function previousSources(project: VersionedProject, migrations: SchemaMigration[]) {
  const prior = project.previous;
  if (!prior) return [];
  if (prior.sources) {
    if (!prior.sources.every(({ name, sha256: digest }, index) => migrations[index]?.name === name && migrations[index]?.sha256 === digest)) {
      throw new IncrementalUnsupported('Previously generated schema sources were changed, reordered or removed.');
    }
    return migrations.slice(0, prior.sources.length);
  }
  const index = migrations.findIndex(({ name }) => 'db/migrations/' + name === prior.migration);
  const owned = project.files.find(({ path }) => path === prior.migration);
  if (index < 0 || !owned || owned.owner !== CRUD_OWNER || owned.sha256 !== migrations[index]?.sha256) {
    throw new IncrementalUnsupported('The original generated schema migration was changed or removed.');
  }
  return migrations.slice(0, index + 1);
}

export function eligibility(project: VersionedProject, schema: DatabaseSchema) {
  const available = withoutWelcome(schema, project);
  return available.tables.map(({ name }) => ({
    name, api: Boolean(project.previous?.backend.includes(name)), page: Boolean(project.previous?.frontend.includes(name)),
    reason: validateCrud({ schema: available, migrations: true, backend: [name], frontend: [] })[0]?.message ?? null,
  }));
}

export function composeIncremental(
  project: VersionedProject, files: ReadonlyMap<string, LocalFile>, schema: DatabaseSchema, oldSchema: DatabaseSchema,
  migrations: SchemaMigration[], requested: { backend: string[]; frontend: string[] },
) {
  const { config, projectId, previous } = project;
  const backend = [...new Set([...(previous?.backend ?? []), ...requested.backend])].sort();
  const frontend = [...new Set([...(previous?.frontend ?? []), ...requested.frontend])].sort();
  const issues: string[] = [];
  const changes: IncrementalChange[] = [];
  const selected = { schema: withoutWelcome(schema, project), migrations: true as const, backend, frontend };
  const errors = validateCrud(selected);
  if (errors.length || !backend.length) return { changes, backend, frontend, issues: errors.length ? errors.map(({ message }) => message) : ['Select a supported table for CRUD generation.'] };
  const oldConfig = previous ? { ...config, crud: { schema: withoutWelcome(oldSchema, project), migrations: true as const,
    backend: previous.backend, frontend: previous.frontend } } : config;
  const before = keyed(planProject(oldConfig, projectId).files);
  if (previous) {
    const oldLock = object(before.get(versionsPath)?.content)?.schema;
    const installed = project.versions.schema;
    if (!isRecord(oldLock) || !isRecord(installed) || installed.templateSha256 !== oldLock.templateSha256) {
      throw new IncrementalUnsupported('The installed CRUD template fingerprint differs from the pinned source and schema history.');
    }
  }
  const after = keyed(planProject({ ...config, crud: selected }, projectId).files);
  const currentVersions = object(after.get(versionsPath)?.content)!;
  const { version, schema: featureVersion, ...stack } = currentVersions;
  const sources = migrations.map(({ name, sha256 }) => ({ name, sha256 }));
  const originalMigration = config.modules.some(({ id }) => id === WELCOME_EXAMPLE.id) ? 'db/migrations/0003_schema.sql' : 'db/migrations/0002_schema.sql';
  const sourceText = (items: typeof sources) => 'Declared migration history: ' + items.map(({ name }) => '`db/migrations/' + name + '`').join(', ') + '.';
  const sourceDoc = (content: string, items: typeof sources) =>
    content.replace('Authoritative SQL migration: `' + originalMigration + '`.', sourceText(items));
  const baselineDoc = before.get('docs/DATABASE_SCHEMA.md');
  if (previous?.sources && baselineDoc) {
    const content = sourceDoc(baselineDoc.content, previous.sources);
    before.set(baselineDoc.path, { ...baselineDoc, content, sha256: sha256(content) });
  }

  const ownership = new Map(project.files.map((file) => [file.path, file]));
  const recorded = new Map(ownership);
  if (config.stack === GO_STACK) {
    const module = files.get('go.mod');
    if (module?.state !== 'text' || module.sha256 !== before.get('go.mod')?.sha256) {
      return { changes, backend, frontend, issues: ['The Go module manifest no longer matches the pinned adapter.'] };
    }
  }
  const descendants = [...foundationPaths, ...(config.stack === GO_STACK ? [goIntegrationPath] : []), ...featuresFor(config.stack)];
  for (const path of descendants) {
    const output = after.get(path);
    if (!output) continue;
    const original = before.get(path);
    const local = files.get(path);
    const owned = ownership.get(path);
    const desired = path === 'docs/DATABASE_SCHEMA.md' ? sourceDoc(output.content, sources) : output.content;
    const intended = sha256(desired);
    if (local?.state === 'text' && local.sha256 === intended && owned?.owner === ownerFor(path, config.stack) && owned.sha256 === intended) {
      changes.push({ path, action: 'unchanged', before: null, after: null, reason: defaultReason });
      continue;
    }
    if (original?.sha256 === intended) {
      const changed = local?.state !== 'text' || local.sha256 !== intended || owned?.owner !== ownerFor(path, config.stack) || owned.sha256 !== intended;
      const critical = path === 'server/routes.ts' || path === goIntegrationPath || (path === 'web/main.tsx' && frontend.length > 0);
      const action = changed ? (critical || (local?.state !== 'text' && !optionalContext.has(path)) ? 'conflict' : 'protected') : 'unchanged';
      changes.push({ path, action, before: null, after: null,
        reason: action === 'conflict' ? 'A required integration or generated dependency cannot be verified.'
          : changed ? 'The reviewed feature needs no changes to this customized file.' : defaultReason });
      continue;
    }
    const strict = local?.state === 'text' && owned?.owner === ownerFor(path, config.stack) && owned.sha256 === local.sha256
      && original?.sha256 === local.sha256;
    const vacant = local?.state === 'absent' && !owned && !original;
    if (!strict && !vacant) {
      changes.push({ path, action: optionalContext.has(path) ? 'protected' : 'conflict', before: null, after: null,
        reason: optionalContext.has(path) ? 'Custom documentation is preserved. Review the generated database and API guides.'
          : 'The path is missing, modified, unsafe, or outside verified generator ownership.' });
      continue;
    }
    changes.push({ path, action: strict ? 'modify' : 'create', before: strict ? local.content : null, after: desired,
      reason: strict ? 'Update the verified built-in integration or generated feature.' : 'Add a file for the selected CRUD layers.' });
    recorded.set(path, { path, sha256: intended, owner: ownerFor(path, config.stack), action: 'create' });
  }
  if (changes.some(({ action }) => action === 'conflict')) issues.push('Resolve the protected integration conflicts before applying this plan.');
  if (!changes.some(({ action }) => action === 'create' || action === 'modify') || issues.length) return { changes, issues, backend, frontend };

  const feature = { ...(featureVersion as Record<string, unknown>) };
  delete feature.migration;
  const { modules: installed, ...stackBase } = stack;
  const versions = { ...stackBase, schema: { ...feature, ...(previous?.migration ? { migration: previous.migration } : {}), sources }, modules: installed };
  const versionBytes = json({ version, ...versions });
  recorded.set(versionsPath, { path: versionsPath, sha256: sha256(versionBytes), owner: config.stack, action: 'create' });
  const inputsSha256 = sha256(json({ projectId, sources, backend, frontend, versions }));
  const manifest = json({ version: 2, projectId, inputsSha256, versions, files: [...recorded.values()] });
  const beforeVersions = text(files, versionsPath);
  const beforeManifest = text(files, manifestPath);
  const locked = ownership.get(versionsPath);
  if (!beforeVersions || !beforeManifest || locked?.owner !== config.stack || locked.sha256 !== sha256(beforeVersions)
    || recorded.size > GENERATOR_LIMITS.files) {
    return { changes, issues: ['The portable metadata is modified or exceeds the supported ownership limit.'], backend, frontend };
  }
  for (const [path, previousText, desired] of [[versionsPath, beforeVersions, versionBytes], [manifestPath, beforeManifest, manifest]] as const) {
    changes.push({ path, action: desired === previousText ? 'unchanged' : 'modify', before: desired === previousText ? null : previousText,
      after: desired === previousText ? null : desired, reason: 'Record reviewed source references, feature selections and exact output fingerprints.' });
  }
  return { changes, issues, backend, frontend };
}

export function composeModuleInstall(
  project: VersionedProject, files: ReadonlyMap<string, LocalFile>, oldSchema: DatabaseSchema,
  migrations: SchemaMigration[], requested: ModuleSelection[],
) {
  const { config, projectId, previous } = project;
  const backend = previous?.backend ?? [];
  const frontend = previous?.frontend ?? [];
  const modules = [...config.modules];
  const changes: IncrementalChange[] = [];
  const issues: string[] = [];
  const result = { changes, issues, backend, frontend, modules };
  if (!stackDefinition(config.stack)?.modules) {
    issues.push('This stack has no verified optional module releases.');
    return result;
  }

  if (new Set(requested.map(({ id }) => id)).size !== requested.length) {
    issues.push('Choose each module once.');
    return result;
  }
  for (const pin of requested) {
    const existing = modules.find(({ id }) => id === pin.id);
    if (!IDENTITY_MODULES.some(({ id, version }) => id === pin.id && version === pin.version)
      || (existing && existing.version !== pin.version)) {
      issues.push('The requested module release or upgrade is unsupported.');
      return result;
    }
    if (!existing) modules.push(pin);
  }
  issues.push(...moduleCompatibility(config.appType, config.database, modules));
  for (const entry of project.files.filter(({ path }) => isModuleMigrationPath(path))) {
    if (migrations.find(({ name }) => 'db/migrations/' + name === entry.path)?.sha256 !== entry.sha256) {
      issues.push('An installed module migration was changed or removed.');
    }
  }
  if (issues.length || modules.length === config.modules.length) return result;
  modules.splice(0, modules.length, ...orderedModules(modules));
  const oldConfig: StarterConfig = {
    ...config, ...(previous ? { crud: { schema: withoutWelcome(oldSchema, project), migrations: true, backend, frontend } } : {}),
  };
  const before = keyed(planProject(oldConfig, projectId).files);
  const after = keyed(planProject({ ...oldConfig, modules }, projectId).files);
  const proposedManifest = after.get(manifestPath)!;
  const proposedOwners = new Map(manifestEntries(new Map([[manifestPath, {
    state: 'text', content: proposedManifest.content, sha256: proposedManifest.sha256,
  }]])).map(({ path, owner }) => [path, owner]));
  const recorded = new Map(project.files.map((item) => [item.path, item]));
  const integration = new Set(['server/app.ts', 'server/routes.ts', 'web/main.tsx']);
  if (config.modules.some(({ id }) => id === AUTHENTICATION.id)) {
    integration.add('server/features/identity/register.ts');
    integration.add('server/features/identity/authentication.ts');
    integration.add('server/features/identity/shared.ts');
  }
  for (const path of integration) {
    const installed = files.get(path);
    if (installed?.state !== 'text' || installed.sha256 !== before.get(path)?.sha256
      || recorded.get(path)?.sha256 !== installed.sha256) {
      changes.push({ path, action: 'conflict', before: null, after: null,
        reason: 'This security integration must match the reviewed starter before installing the module.' });
    }
  }
  const conflicts = new Set(changes.map(({ path }) => path));
  for (const path of [...foundationPaths, ...featurePaths.filter((path) => path !== 'docs/DATABASE_SCHEMA.md'), ...identityFiles]) {
    const next = after.get(path);
    if (!next || conflicts.has(path) || before.get(path)?.sha256 === next.sha256) continue;
    const prior = before.get(path);
    const local = files.get(path);
    const owner = proposedOwners.get(path) ?? STARTER.stack;
    const known = recorded.get(path);
    const vacant = !prior && !known && local?.state === 'absent';
    // Shared identity integrations may change when a dependency is added. Their original
    // bytes and ownership must still match the previously rendered stack.
    const trusted = Boolean(prior && known && local?.state === 'text' && local.sha256 === prior.sha256 && known.sha256 === local.sha256);
    if (!vacant && !trusted) {
      changes.push({ path, action: optionalContext.has(path) ? 'protected' : 'conflict', before: null, after: null,
        reason: optionalContext.has(path) ? 'Custom instructions are preserved. See the generated identity guide.' : 'The required integration is customized, unowned, missing or unsafe.' });
      continue;
    }
    changes.push({ path, action: vacant ? 'create' : 'modify', before: vacant ? null : text(files, path)!, after: next.content,
      reason: 'Integrate the exact reviewed module release.' });
    recorded.set(path, { path, owner, action: 'create', sha256: next.sha256 });
  }

  let ordinal = Number(migrations.at(-1)?.name.slice(0, 4) ?? 0);
  for (const next of after.values()) {
    const owner = identityOwner(next.path);
    if (!owner || config.modules.some(({ id }) => owner === id)) continue;
    const suffix = next.path.slice('db/migrations/0000_'.length);
    const path = 'db/migrations/' + String(++ordinal).padStart(4, '0') + '_' + suffix;
    if (ordinal > 9999 || recorded.has(path) || files.has(path)) {
      issues.push('A new module migration cannot be appended safely.');
      break;
    }
    changes.push({ path, action: 'create', before: null, after: next.content, reason: 'Append a module migration without changing the database or previous SQL.' });
    recorded.set(path, { path, owner, action: 'create', sha256: next.sha256 });
  }
  if (changes.some(({ action }) => action === 'conflict')) issues.push('Resolve the marked integration conflicts before installing.');
  if (issues.length) return result;
  const next = object(after.get(versionsPath)?.content)!;
  const { version, schema: _schema, modules: pinned, ...stack } = next;
  void _schema;
  const versions = { ...stack, ...(project.versions.schema ? { schema: project.versions.schema } : {}), modules: pinned };
  const stackBytes = json({ version, ...versions });
  const moduleBytes = after.get(modulePath)!.content;
  for (const [path, data] of [[versionsPath, stackBytes], [modulePath, moduleBytes]] as const) {
    const current = text(files, path);
    if (!current || recorded.get(path)?.sha256 !== sha256(current)) {
      issues.push('The project version or module lock was edited.');
      return result;
    }
    changes.push({ path, action: 'modify', before: current, after: data, reason: 'Pin exact module versions and dependency fingerprints.' });
    recorded.set(path, { path, owner: STARTER.stack, action: 'create', sha256: sha256(data) });
  }
  const manifest = json({ version: 2, projectId, inputsSha256: sha256(json({ projectId, versions })), versions, files: [...recorded.values()] });
  changes.push({ path: manifestPath, action: 'modify', before: text(files, manifestPath)!, after: manifest, reason: 'Record ownership and fingerprints of the reviewed module output.' });
  if (recorded.size > GENERATOR_LIMITS.files) issues.push('This installation exceeds the supported manifest size.');
  if (!modules.some(({ id }) => id === AUTHENTICATION.id)) issues.push('The authentication dependency is required.');
  return result;
}
