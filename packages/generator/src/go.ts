import { GO_STACK, STACKS, STACK_SDK_VERSION } from '@factory/contracts';
import type { StarterConfig } from '@factory/contracts';
import { composeCrud, CRUD_OWNER } from './crud';
import { libraryFiles } from './library';
import { foundationTemplates } from './modular';

import recordContract from '../templates/crud/server/contracts.ts?raw';
import goMod from '../templates/go/go.mod?raw';
import goSum from '../templates/go/go.sum?raw';
import webManifest from '../templates/go/package.json?raw';
import webLock from '../templates/go/pnpm-lock.yaml?raw';
import env from '../templates/go/.env.example?raw';
import ignore from '../templates/go/.gitignore?raw';
import agents from '../templates/go/AGENTS.md?raw';
import readme from '../templates/go/README.md?raw';
import architecture from '../templates/go/docs/ARCHITECTURE.md?raw';
import standards from '../templates/go/docs/CODING_STANDARDS.md?raw';
import requirements from '../templates/go/docs/REQUIREMENTS.md?raw';
import cmdServer from '../templates/go/cmd/server/main.go?raw';
import cmdMigrate from '../templates/go/cmd/migrate/main.go?raw';
import configGo from '../templates/go/internal/platform/config.go?raw';
import migrateGo from '../templates/go/internal/platform/migrations.go?raw';
import http from '../templates/go/internal/httpapp/http.go?raw';
import httpTest from '../templates/go/internal/httpapp/http_test.go?raw';
import model from '../templates/go/internal/records/model.go?raw';
import handler from '../templates/go/internal/records/handler.go?raw';
import repository from '../templates/go/internal/records/repository.go?raw';
import service from '../templates/go/internal/records/service.go?raw';
import serviceTest from '../templates/go/internal/records/service_test.go?raw';

type Template = readonly [path: string, content: string];

const goRecords: readonly Template[] = [
  ['internal/records/model.go', model], ['internal/records/handler.go', handler],
  ['internal/records/repository.go', repository], ['internal/records/service.go', service],
  ['internal/records/service_test.go', serviceTest],
];

const goBase: readonly Template[] = [
  ...foundationTemplates.filter(([path]) => [
    '.gitattributes', '.node-version', '.npmrc', 'eslint.config.js', 'tsconfig.json', 'vite.config.ts',
    'web/index.html', 'web/styles.css', 'web/main.tsx', 'db/migrations/0001_baseline.sql',
  ].includes(path)),
  ['go.mod', goMod], ['go.sum', goSum], ['package.json', webManifest], ['pnpm-lock.yaml', webLock],
  ['.env.example', env], ['.gitignore', ignore], ['README.md', readme], ['AGENTS.md', agents],
  ['docs/ARCHITECTURE.md', architecture], ['docs/CODING_STANDARDS.md', standards], ['docs/REQUIREMENTS.md', requirements],
  ['cmd/server/main.go', cmdServer], ['cmd/migrate/main.go', cmdMigrate],
  ['internal/platform/config.go', configGo], ['internal/platform/migrations.go', migrateGo],
  ['internal/httpapp/http.go', http], ['internal/httpapp/http_test.go', httpTest],
];

const webContractPath = 'web/features/crud/contracts.ts';
export const goCrudPaths = [...goRecords.map(([path]) => path), 'internal/records/tables.go', webContractPath];
export const goIntegrationPath = 'internal/httpapp/http.go';

type Fingerprint = (templates: readonly Template[]) => string;

export function composeGo(config: StarterConfig, hash: Fingerprint, digest: (value: string) => string) {
  const crud = config.crud && composeCrud(config.crud, false);
  const library = config.library && libraryFiles(config.library, config.name, 'Go, Gin, React, Vite and PostgreSQL with Go Service conventions');
  const modulePath = 'example.com/factory/' + config.slug;
  const hasAPI = Boolean(config.crud?.backend.length);
  const feature: Template[] = crud?.files.filter(([path]) => path.startsWith('db/') || path.startsWith('docs/') || path.startsWith('web/')) ?? [];
  if (config.crud?.frontend.length) {
    const index = feature.findIndex(([path]) => path === 'web/features/crud/Crud.tsx');
    const [path, component] = feature[index]!;
    feature[index] = [path, component.replace('../../../server/features/crud/contracts.ts', './contracts.ts')];
    feature.push([webContractPath, recordContract.split('export const tables:')[0]!.trimEnd() + '\n']);
  }
  if (hasAPI) {
    const tables = config.crud!.schema.tables.filter(({ name }) => config.crud!.backend.includes(name));
    feature.push(...goRecords, ['internal/records/tables.go', 'package records\n\nvar tables = []table{\n'
      + tables.map(({ name, columns, constraints }) => {
        const primary = constraints.find(({ kind }) => kind === 'primary');
        if (!primary || !('columns' in primary)) throw new Error('Go CRUD requires a primary key.');
        return '\t{' + JSON.stringify(name) + ', ' + JSON.stringify(primary.columns[0]) + ', []field{\n'
          + columns.map(({ name, type, nullable, default: value }) =>
            '\t\t{' + JSON.stringify(name) + ', ' + JSON.stringify(type) + ', ' + nullable + ', ' + Boolean(value) + '},\n').join('')
          + '\t}},\n';
      }).join('') + '}\n']);
  }
  const slots = {
    WEBIMPORTS: crud?.slots.WEBIMPORTS ?? '', WEBPANELS: crud?.slots.WEBPANELS ?? '',
    AGENTFEATURES: crud?.slots.AGENTFEATURES ?? '', READMEFEATURES: crud?.slots.READMEFEATURES.replace('pnpm db:migrate', 'go run -mod=readonly -buildvcs=false ./cmd/migrate') ?? '',
    ARCHFEATURES: hasAPI ? 'Generated model descriptors, validation, repositories and handlers live in internal/records/. They register selected tables at /api/crud.' : '',
    REQFEATURES: crud?.slots.REQFEATURES ?? '',
    CRUDIMPORT: hasAPI ? '\t"' + modulePath + '/internal/records"\n' : '',
    CRUDREGISTER: hasAPI ? '\trecords.Register(api, pool)\n' : '',
  };
  if (library) {
    slots.AGENTFEATURES += '- Read docs/ENGINEERING_PROFILE.md for ' + config.library!.profile.name + ' v' + config.library!.profile.version + '.\n';
    slots.READMEFEATURES += 'See [Engineering profile](docs/ENGINEERING_PROFILE.md) for the pinned advisory conventions.\n';
    if (config.library?.template) {
      slots.WEBIMPORTS += "import { BusinessShell } from './features/business/BusinessShell.tsx';\n";
      slots.ARCHFEATURES += '\nBusiness Workspace provides the branded application shell.';
    }
  }
  const templates = goBase.map(([path, content]) => [path,
    path.endsWith('.go') || path === 'go.mod' ? content.replaceAll('example.com/factory/application', modulePath)
      : path === 'web/main.tsx' && config.library?.template ? content.replace('render(<App />)', 'render(<BusinessShell><App /></BusinessShell>)')
      : path === 'tsconfig.json' ? content.replace('"server", "web", "test", "vite.config.ts"', '"web", "vite.config.ts"') : content,
  ] as const);
  const versions = {
    generator: '2.0.0',
    stack: { id: GO_STACK, version: STACKS[GO_STACK].version, sdk: STACK_SDK_VERSION, templateSha256: hash(goBase) },
    architecture: { id: config.architecture, version: '1.0.0' },
    engineering: { id: config.engineering, version: '1.0.0' },
    database: config.database,
    ...(library && config.library ? { library: {
      profile: { id: config.library.profile.id, version: config.library.profile.version },
      ...(config.library.template ? { template: { id: config.library.template.id, version: config.library.template.version, sha256: hash(library.files) } } : {}),
      sha256: digest(JSON.stringify(config.library, null, 2) + '\n'),
    } } : {}),
    ...(crud ? { schema: { id: CRUD_OWNER, version: '1.0.0', migration: crud.migrationPath, templateSha256: hash(feature),
      backend: config.crud!.backend, frontend: config.crud!.frontend } } : {}),
    modules: [],
  };
  return { templates, feature, library, slots, versions, webValues: crud?.values };
}
