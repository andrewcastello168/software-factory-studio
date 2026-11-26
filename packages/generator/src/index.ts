import { createHash } from 'node:crypto';
import {
  AUDIT_LOGGING, AUTHENTICATION, GENERATOR_LIMITS, GO_STACK, NODE_STACK, RBAC, SCHEMA_LIMITS, WELCOME_EXAMPLE, isGeneratorPath, isLegacyStarterConfig, isProjectId, isStarterConfig, MODULE_CATALOG, STARTER, STACKS,
} from '@factory/contracts';
import type { GeneratorFile, LegacyStarterConfig, StarterConfig } from '@factory/contracts';
import { composeCrud, CRUD_OWNER, InvalidCrud, normalizeCrud } from './crud';
import { composeModules, foundationTemplates } from './modular';
import { nodeTemplates } from './templates';
import auditManagement from '../templates/identity/web/Management.tsx?raw';
import { identityGuide, IDENTITY_PREFIX, identityValues, protectCrudTemplate } from './identity';
import { libraryFiles, normalizeLibrary } from './library';
import { composeGo } from './go';
export { identityMigration, IDENTITY_PREFIX } from './identity';

export { InvalidCrud } from './crud';
export * from './incremental';

export interface StarterPlan<Config = StarterConfig | LegacyStarterConfig> {
  projectId: string;
  config: Config;
  digest: string;
  files: GeneratorFile[];
}

export function sha256(value: string | Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const normalize = (text: string) => text.replace(/\r\n/gu, '\n');
const templateHashes = (templates: readonly (readonly [string, string])[]) =>
  templates.map(([path, text]) => [path, sha256(normalize(text))]);

function file(path: string, content: string): GeneratorFile {
  if (!isGeneratorPath(path) || Buffer.byteLength(content) > GENERATOR_LIMITS.fileBytes || content.includes('\0')) {
    throw new Error('Invalid built-in generator output.');
  }
  return { path, content, sha256: sha256(content) };
}

function coreConfig<Config extends LegacyStarterConfig | StarterConfig>(config: Config): Pick<Config, 'name' | 'slug' | 'port' | 'appType' | 'stack' | 'architecture' | 'engineering'> {
  const { name, slug, port, appType, stack, architecture, engineering } = config;
  return { name, slug, port, appType, stack, architecture, engineering };
}

function renderingValues(config: LegacyStarterConfig | StarterConfig) {
  return { NAME: config.name, TITLE: JSON.stringify(config.name), PORT: String(config.port), DATABASE: config.slug.replace(/-/gu, '_') };
}

function render(
  templates: readonly (readonly [string, string])[], slug: string, values: Readonly<Record<string, string>>,
  testPaths: readonly string[] = [],
) {
  return templates.map(([path, template]) => {
    const text = normalize(template).replace(/@@([A-Z]+)@@/gu, (_all, key: string) => {
      const value = values[key];
      if (value === undefined) throw new Error('Unknown built-in template parameter.');
      return value;
    });
    if (path !== 'package.json') return file(path, text);
    const manifest = JSON.parse(text) as { name: string; scripts: Record<string, string> };
    if (testPaths.length) {
      manifest.scripts.test = 'node --experimental-strip-types --env-file-if-exists=.env --test ' + testPaths.join(' ');
    }
    return file(path, json({ ...manifest, name: slug }));
  });
}

function projectDescriptor(config: LegacyStarterConfig | StarterConfig, projectId: string) {
  return file('.factory/project.json', json({
    version: 1, id: projectId, name: config.name, type: config.appType, stackId: config.stack, profileId: config.architecture,
  }));
}

function finalize<Config>(
  config: Config, projectId: string, files: GeneratorFile[], owners: ReadonlyMap<string, string>, fallbackOwner: string,
  versions: object, manifestVersion: number,
): StarterPlan<Config> {
  const fingerprints = () => files.map(({ path, sha256 }) => ({ path, sha256, owner: owners.get(path) ?? fallbackOwner, action: 'create' }));
  files.push(file('.factory/generation-manifest.json', json({
    version: manifestVersion, projectId, inputsSha256: sha256(json({ projectId, config })), versions, files: fingerprints(),
  })));
  const paths = files.map(({ path }) => path.toLowerCase());
  const entries = new Set(paths);
  if (files.length > GENERATOR_LIMITS.files || entries.size !== paths.length || paths.some((path) => {
    const parts = path.split('/');
    return parts.slice(1).some((_part, index) => entries.has(parts.slice(0, index + 1).join('/')));
  })) {
    throw new Error('Conflicting or excessive built-in generator outputs.');
  }
  return { projectId, config, digest: sha256(json({ projectId, config, files: fingerprints() })), files };
}

/** Reproduce already-approved Phase 04 v1 journals. New IPC requests require the modular configuration. */
export function planLegacyProject(input: LegacyStarterConfig, projectId: string): StarterPlan<LegacyStarterConfig> {
  if (!isLegacyStarterConfig(input) || !isProjectId(projectId)) throw new Error('Unsupported legacy project configuration.');
  const config = { ...coreConfig(input), appType: input.appType };
  const versions = {
    generator: '1.0.0',
    stack: { id: config.stack, version: '1.0.0', templateSha256: sha256(json(templateHashes(nodeTemplates))) },
    architecture: { id: config.architecture, version: '1.0.0' },
    engineering: { id: config.engineering, version: '1.0.0' },
  };
  const files = render(nodeTemplates, config.slug, renderingValues(config));
  files.push(projectDescriptor(config, projectId), file('.factory/versions.lock.json', json({ version: 1, ...versions })));
  return finalize(config, projectId, files, new Map(), config.stack, versions, 1);
}

export function planProject(input: StarterConfig, projectId: string): StarterPlan<StarterConfig> {
  if (!isStarterConfig(input) || !isProjectId(projectId)) throw new Error('Unsupported project configuration.');
  const config: StarterConfig = {
    ...coreConfig(input), database: input.database,
    ...(input.crud ? { crud: normalizeCrud(input.crud) } : {}),
    ...(input.library ? { library: normalizeLibrary(input.library) } : {}),
    modules: input.modules.map(({ id, version }) => ({ id, version })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  };
  if (config.crud && Buffer.byteLength(json(config)) > 36_000) throw new InvalidCrud('Schema exceeds the portable generation limit.');
  if (config.crud?.schema.tables.some(({ name }) => name.startsWith(IDENTITY_PREFIX))) throw new InvalidCrud('The identity table namespace is reserved.');
  return stackAdapters[config.stack].plan(config, projectId);
}

function planNode(config: StarterConfig, projectId: string): StarterPlan<StarterConfig> {
  const { modules, slots, testPaths } = composeModules(config.modules);
  const withWelcome = modules.some(({ id }) => id === WELCOME_EXAMPLE.id);
  const auth = modules.some(({ id }) => id === AUTHENTICATION.id);
  const managementPage = modules.some(({ id }) => id === AUDIT_LOGGING.id || id === 'user-management');
  const infrastructure = Number(withWelcome) + (auth ? 3 : 0)
    + (modules.some(({ id }) => id === RBAC.id) ? 3 : 0) + (modules.some(({ id }) => id === AUDIT_LOGGING.id) ? 1 : 0);
  if ((config.crud?.schema.tables.length ?? 0) + infrastructure > SCHEMA_LIMITS.tables) {
    throw new InvalidCrud('The business schema and module tables exceed the project schema limit.');
  }
  const crud = config.crud && composeCrud(config.crud, withWelcome);
  const library = config.library && libraryFiles(config.library, config.name);
  if (library) {
    slots.AGENTFEATURES += '- Follow docs/ENGINEERING_PROFILE.md for the advisory profile ' + config.library!.profile.name
      + ' v' + config.library!.profile.version + '. Keep client requirements separate.\n';
    slots.READMEFEATURES += 'See [Engineering profile](docs/ENGINEERING_PROFILE.md) for the pinned advisory conventions.\n\n';
    if (config.library?.template) slots.ARCHFEATURES += '\nThe selected Business Workspace template provides the application layout and project branding.\n';
  }
  if (auth) {
    slots.WEBIMPORTS = slots.WEBIMPORTS.replace('IdentityGate, RecordAccess', config.crud?.frontend.length ? 'IdentityGate, RecordAccess' : 'IdentityGate');
    const registration = '  registerIdentity(router, pool);\n';
    slots.APIROUTES = registration + slots.APIROUTES.replace(registration, '');
    slots.AGENTFEATURES += '- Installed identity releases: ' + config.modules.filter(({ id }) => id !== WELCOME_EXAMPLE.id)
      .map(({ id, version }) => id + ' v' + version).join(', ') + '.\n';
  }
  if (config.library?.template) slots.WEBIMPORTS += "import { BusinessShell } from './features/business/BusinessShell.tsx';\n";
  if (crud) {
    for (const key of Object.keys(slots) as (keyof typeof slots)[]) slots[key] += crud.slots[key];
    testPaths.push(...crud.testPaths);
  }
  if (auth) {
    slots.WEBPANELS = slots.WEBPANELS.replace('<CrudWorkspace />', '<RecordAccess>{(canWrite) => <CrudWorkspace readOnly={!canWrite} />}</RecordAccess>');
    slots.READMEFEATURES = slots.READMEFEATURES.replace(' These routes have no built-in authentication.', '');
    slots.REQFEATURES = slots.REQFEATURES.replace(' Access control is a deployment requirement.', '');
  }
  const versions = {
    generator: STARTER.engineVersion,
    stack: { id: config.stack, version: STARTER.templateVersion, templateSha256: sha256(json(templateHashes(foundationTemplates))) },
    architecture: { id: config.architecture, version: STARTER.architectureVersion },
    engineering: { id: config.engineering, version: STARTER.engineeringVersion },
    database: config.database,
    ...(library && config.library ? { library: {
      profile: { id: config.library.profile.id, version: config.library.profile.version },
      ...(config.library.template ? { template: { id: config.library.template.id, version: config.library.template.version, sha256: sha256(json(templateHashes(library.files))) } } : {}),
      sha256: sha256(json(config.library)),
    } } : {}),
    ...(crud ? { schema: { id: CRUD_OWNER, version: '1.0.0', migration: crud.migrationPath,
      templateSha256: sha256(json({ files: templateHashes(crud.files), slots: crud.slots, values: crud.values })),
      backend: config.crud!.backend, frontend: config.crud!.frontend } } : {}),
    modules: modules.map(({ id, version, templates, slots, tests, migration }) => ({
      id, version, templateSha256: sha256(json({ files: templateHashes(templates), slots, tests, ...(migration ? { migration: [migration[0], sha256(normalize(migration[1]))] } : {}) })),
      requires: MODULE_CATALOG.find((module) => module.id === id)!.requires,
    })),
  };
  const values = { ...renderingValues(config), ...slots, ...crud?.values, ...library?.values, ...identityValues(config.modules) };
  let root = '<App />';
  if (auth) root = '<IdentityGate>' + root + '</IdentityGate>';
  if (config.library?.template) root = '<BusinessShell>' + root + '</BusinessShell>';
  const foundation = root === '<App />' ? foundationTemplates : foundationTemplates.map(([path, text]) =>
    [path, path === 'web/main.tsx' ? text.replace('render(<App />)', 'render(' + root + ')') : text] as const);
  const files = render(foundation, config.slug, values, testPaths);
  const owners = new Map<string, string>();
  let sequence = 1 + Number(withWelcome) + Number(Boolean(crud));
  for (const module of modules) {
    if (module.migration) {
      const path = 'db/migrations/' + String(++sequence).padStart(4, '0') + '_' + module.migration[0] + '.sql';
      files.push(file(path, normalize(module.migration[1])));
      owners.set(path, module.id);
    }
    for (const planned of render(module.templates, config.slug, values)) {
      files.push(planned);
      owners.set(planned.path, module.id);
    }
  }
  if (auth) {
    for (const additional of [
      file('docs/IDENTITY.md', identityGuide(config.modules.filter(({ id }) => id !== WELCOME_EXAMPLE.id))),
      ...(managementPage ? render([['web/features/identity/Management.tsx', auditManagement]], config.slug, values) : []),
    ]) { files.push(additional); owners.set(additional.path, AUTHENTICATION.id); }
  }
  if (library) files.push(...render(library.files, config.slug, values), file('docs/ENGINEERING_PROFILE.md', library.guidance),
    file('.factory/engineering.json', json(config.library)));
  if (crud) {
    for (const [path, content] of crud.files) {
      // SQL and documentation are finalized data, not template expressions.
      const planned = path.startsWith('db/') || path.startsWith('docs/')
        ? file(path, auth && path === 'docs/CRUD_API.md'
          ? content.replace('These generated routes are unauthenticated. Use appropriate deployment and access controls.',
            'These generated routes require an active session. Follow docs/IDENTITY.md for authorization details.') : content)
        : render([[path, auth ? protectCrudTemplate(path, content) : content]], config.slug, values)[0]!;
      files.push(planned);
      owners.set(path, CRUD_OWNER);
    }
  }
  files.push(
    projectDescriptor(config, projectId),
    file('.factory/versions.lock.json', json({ version: 2, ...versions })),
    file('.factory/modules.json', json({ version: 1, installed: versions.modules })),
  );
  return finalize(config, projectId, files, owners, config.stack, versions, 2);
}

function planGo(config: StarterConfig, projectId: string): StarterPlan<StarterConfig> {
  const { templates, feature, library, slots, versions, webValues } = composeGo(config,
    (sources) => sha256(json(templateHashes(sources))), sha256);
  const values = { ...renderingValues(config), ...slots, ...webValues, ...library?.values };
  const files = render(templates, config.slug, values);
  const owners = new Map<string, string>();
  for (const [path, content] of feature) {
    files.push(path.startsWith('web/') ? render([[path, content]], config.slug, values)[0]! : file(path, normalize(content)));
    owners.set(path, CRUD_OWNER);
  }
  if (library) files.push(...render(library.files, config.slug, values), file('docs/ENGINEERING_PROFILE.md', library.guidance),
    file('.factory/engineering.json', json(config.library)));
  files.push(projectDescriptor(config, projectId), file('.factory/versions.lock.json', json({ version: 2, ...versions })),
    file('.factory/modules.json', json({ version: 1, installed: [] })));
  return finalize(config, projectId, files, owners, config.stack, versions, 2);
}

interface BuiltInStackAdapter {
  manifest: typeof STACKS[StarterConfig['stack']];
  plan(config: StarterConfig, projectId: string): StarterPlan<StarterConfig>;
}

const stackAdapters = {
  [NODE_STACK]: { manifest: STACKS[NODE_STACK], plan: planNode },
  [GO_STACK]: { manifest: STACKS[GO_STACK], plan: planGo },
} satisfies Record<StarterConfig['stack'], BuiltInStackAdapter>;

export { artifactLinks, composeDesign, describeDesign, readDesign } from './design';

export { composeDelivery, deliveryTemplates } from './delivery';
export { canonicalAsset, readSharedBundle, sharedBundle } from './sharing';
