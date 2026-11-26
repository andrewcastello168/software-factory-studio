import { emptySchema, orderedSchema, planMigration, validateCrud } from '@factory/schema';
import type { CrudSelection, SchemaTable } from '@factory/contracts';
import contracts from '../templates/crud/server/contracts.ts?raw';
import validation from '../templates/crud/server/validation.ts?raw';
import repository from '../templates/crud/server/repository.ts?raw';
import service from '../templates/crud/server/service.ts?raw';
import controller from '../templates/crud/server/controller.ts?raw';
import register from '../templates/crud/server/register.ts?raw';
import test from '../templates/crud/test.ts?raw';
import page from '../templates/crud/web/Crud.tsx?raw';
import css from '../templates/crud/web/crud.css?raw';

export const CRUD_OWNER = 'postgresql-crud';
export class InvalidCrud extends Error {}

const orderNames = (names: string[]) => [...names].sort();

export function normalizeCrud(input: CrudSelection): CrudSelection {
  const errors = validateCrud(input);
  if (errors.length) throw new InvalidCrud(errors[0]!.message);
  return { schema: orderedSchema(input.schema), migrations: true, backend: orderNames(input.backend), frontend: orderNames(input.frontend) };
}

function definition(table: SchemaTable) {
  const key = table.constraints.find((constraint) => constraint.kind === 'primary');
  if (!key || !('columns' in key)) throw new InvalidCrud('CRUD requires a primary key.');
  return {
    name: table.name, key: key.columns[0],
    columns: table.columns.map(({ name, type, nullable, default: value }) => ({ name, type, nullable, hasDefault: Boolean(value) })),
  };
}

export function composeCrud(config: CrudSelection, withWelcome: boolean) {
  if (withWelcome && config.schema.tables.some(({ name }) => name === 'welcome_messages'
    || /^welcome_messages_(?:pkey|message_check)$/u.test(name))) {
    throw new InvalidCrud('The selected Welcome example owns these names.');
  }
  if (withWelcome && config.schema.tables.some(({ constraints }) =>
    constraints.some(({ name }) => name === 'welcome_messages_pkey'))) {
    throw new InvalidCrud('The selected Welcome example owns the welcome_messages_pkey constraint.');
  }
  const migration = planMigration(emptySchema(), config.schema);
  if (migration.diagnostics.length) throw new InvalidCrud(migration.diagnostics[0]!.message);
  const migrationPath = 'db/migrations/' + (withWelcome ? '0003' : '0002') + '_schema.sql';
  const files: [string, string][] = [
    [migrationPath, migration.sql],
    ['docs/DATABASE_SCHEMA.md', '# Database schema\n\nAuthoritative SQL migration: `' + migrationPath + '`.\n\n'
      + config.schema.tables.map((table) => '## ' + table.name + '\n\n'
        + table.columns.map((column) => '- `' + column.name + '` · ' + column.type + (column.nullable ? ' · nullable' : ' · required')).join('\n')
        + '\n\n' + table.constraints.map((key) => '- `' + key.name + '` · ' + key.kind + (key.kind === 'foreign' ? ' → `' + key.table + '`' : '')).join('\n')).join('\n\n') + '\n'],
  ];
  const backend = config.schema.tables.filter(({ name }) => config.backend.includes(name));
  const frontend = config.schema.tables.filter(({ name }) => config.frontend.includes(name));
  const slots = {
    APIIMPORTS: backend.length ? "import { registerCrud } from './features/crud/register.ts';\n" : '',
    APIROUTES: backend.length ? '  registerCrud(router, pool);\n' : '',
    WEBIMPORTS: frontend.length ? "import { CrudWorkspace } from './features/crud/Crud.tsx';\n" : '',
    WEBPANELS: frontend.length ? '    <CrudWorkspace />\n' : '',
    AGENTFEATURES: '- Review docs/DATABASE_SCHEMA.md for the generated tables.' + (backend.length ? ' Read docs/CRUD_API.md before changing the generated data routes.' : '') + '\n',
    READMEFEATURES: '## Database schema\n\nSee [Database schema](docs/DATABASE_SCHEMA.md) for the selected tables. Run `pnpm db:migrate` before using the application.\n\n'
      + (backend.length ? 'See [CRUD API](docs/CRUD_API.md) for the selected data routes. Restrict deployment to an environment with appropriate network and access controls. These routes have no built-in authentication.\n\n' : ''),
    ARCHFEATURES: backend.length ? '\nThe generated CRUD adapter registers selected tables under /api/crud. Descriptors, validation, repositories, services and controllers live in server/features/crud/.' + (frontend.length ? ' The React record workspace lives in web/features/crud/.' : '') + '\n' : '',
    REQFEATURES: backend.length ? '- The generated API offers record management for ' + config.backend.join(', ') + '.'
      + (frontend.length ? ' React pages are enabled for ' + config.frontend.join(', ') + '.' : '') + ' Access control is a deployment requirement.\n' : '',
  };
  const values = {
    CRUDDEFINITIONS: JSON.stringify(backend.map(definition), null, 2),
    CRUDWEBDEFINITIONS: JSON.stringify(frontend.map(definition), null, 2),
    CRUDTYPES: backend.map((table) => {
      const name = 'Row_' + table.name;
      return 'export interface ' + name + ' {\n' + table.columns.map((column) => '  ' + JSON.stringify(column.name)
        + ': ' + (['integer', 'smallint'].includes(column.type) ? 'number' : column.type === 'boolean' ? 'boolean' : 'string')
        + (column.nullable ? ' | null' : '') + ';').join('\n') + '\n}';
    }).join('\n\n'),
  };
  if (backend.length) {
    files.push(
      ['server/features/crud/contracts.ts', contracts], ['server/features/crud/validation.ts', validation],
      ['server/features/crud/repository.ts', repository], ['server/features/crud/service.ts', service],
      ['server/features/crud/controller.ts', controller], ['server/features/crud/register.ts', register], ['test/crud.test.ts', test],
      ['docs/CRUD_API.md', '# Record API\n\nThese generated routes are unauthenticated. Use appropriate deployment and access controls.\n\n'
        + 'Selected tables: ' + config.backend.map((name) => '`' + name + '`').join(', ') + '.\n\n'
        + 'For each `/api/crud/<table>`, GET lists records and POST creates a record with a JSON body. '
        + 'GET returns `{ data: { rows, hasMore } }` and accepts `q`, `limit` (1–100), and `offset` (0–10000). '
        + 'Use GET, PATCH, or DELETE on `/api/crud/<table>/record?id=…` for one record. PATCH only changes supplied fields. '
        + 'Invalid inputs use 400, missing records use 404, and PostgreSQL constraint violations use 409.\n'],
    );
  }
  if (frontend.length) files.push(['web/features/crud/Crud.tsx', page], ['web/features/crud/crud.css', css]);
  return { files, slots, testPaths: backend.length ? ['test/crud.test.ts'] : [], values, migrationPath };
}
