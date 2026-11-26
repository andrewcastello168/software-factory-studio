import type { Result } from './index';
import { isProjectId } from './projects';
import { hasExactKeys, isRecord } from './validation';

export const SCHEMA_LIMITS = { tables: 32, columns: 32, constraints: 32, migrations: 128, sql: 48_000, diagnostics: 64 } as const;
export const PG_TYPES = ['smallint', 'integer', 'bigint', 'text', 'boolean', 'date', 'timestamp', 'timestamptz', 'uuid', 'numeric', 'jsonb'] as const;
export type PgType = typeof PG_TYPES[number];
export type PgLiteral = string | number | boolean;
export type PgDefault = { kind: 'literal'; value: PgLiteral } | { kind: 'current-date' | 'current-timestamp' };
export const CHECK_OPERATORS = ['=', '<>', '<', '<=', '>', '>='] as const;
export const FK_ACTIONS = ['no action', 'restrict', 'cascade', 'set null'] as const;

export interface SchemaColumn { name: string; type: PgType; nullable: boolean; default?: PgDefault }
export type SchemaConstraint =
  | { name: string; kind: 'primary' | 'unique'; columns: string[] }
  | { name: string; kind: 'index'; columns: string[] }
  | { name: string; kind: 'foreign'; columns: string[]; table: string; references: string[]; onDelete: typeof FK_ACTIONS[number] }
  | { name: string; kind: 'check'; column: string; operator: typeof CHECK_OPERATORS[number]; value: PgLiteral; measure: 'value' | 'length' };
export interface SchemaTable { name: string; columns: SchemaColumn[]; constraints: SchemaConstraint[] }
export interface DatabaseSchema { version: 1; tables: SchemaTable[] }
export interface SchemaPoint { table: string; x: number; y: number }
export interface SchemaDiagnostic { source: string; line: number; message: string }
export interface SchemaMigration { name: string; sql: string; sha256: string }
export interface SchemaSnapshot {
  schema: DatabaseSchema;
  revision: string;
  migrations: SchemaMigration[];
  diagnostics: SchemaDiagnostic[];
  layout: SchemaPoint[];
  recovery: { id: string; migration: SchemaMigration } | null;
}
export interface SchemaWorkspace { projectId: string; revision: string }
export interface SchemaEdit extends SchemaWorkspace { schema: DatabaseSchema }
export interface SchemaLayout extends SchemaWorkspace { points: SchemaPoint[] }
export interface SchemaConnection extends SchemaWorkspace {
  host: string; port: number; database: string; user: string; password: string; namespace: string;
}
export interface SchemaPhysical {
  revision: string;
  target: string;
  schema: DatabaseSchema;
  observedAt: string;
  diagnostics: SchemaDiagnostic[];
  applied: { name: string; sha256: string }[];
  pending: string[] | null;
  differences: string[];
}
export interface MigrationPreview { id: string; migration: SchemaMigration | null; diagnostics: SchemaDiagnostic[] }
export interface SqlImport { sql: string; schema: DatabaseSchema }
export interface SchemaProposal { schema: DatabaseSchema; diagnostics: SchemaDiagnostic[] }
export interface CrudSelection { schema: DatabaseSchema; migrations: true; backend: string[]; frontend: string[] }

export const SCHEMA_CHANNEL = {
  inspect: 'factory:schema-inspect', parse: 'factory:schema-parse', preview: 'factory:schema-preview',
  publish: 'factory:schema-publish', layout: 'factory:schema-layout', physical: 'factory:schema-physical',
  apply: 'factory:schema-apply', release: 'factory:schema-release',
} as const;

export interface SchemaBridge {
  inspect(id: string): Promise<Result<SchemaSnapshot>>;
  parse(input: SqlImport): Promise<Result<SchemaProposal>>;
  preview(input: SchemaEdit): Promise<Result<MigrationPreview>>;
  publish(input: SchemaWorkspace & { id: string }): Promise<Result<SchemaSnapshot | null>>;
  release(input: SchemaWorkspace & { id: string }): Promise<Result<SchemaSnapshot | null>>;
  layout(input: SchemaLayout): Promise<Result<SchemaPoint[]>>;
  physical(input: SchemaConnection): Promise<Result<SchemaPhysical | null>>;
  apply(input: SchemaConnection): Promise<Result<SchemaPhysical | null>>;
}

const member = <T extends string>(values: readonly T[], item: unknown): item is T =>
  typeof item === 'string' && (values as readonly string[]).includes(item);
const bounded = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max && !x.includes('\0');
const list = <T>(x: unknown, limit: number, check: (item: unknown) => item is T): x is T[] =>
  Array.isArray(x) && x.length <= limit && x.every(check);
const digest = (x: unknown): x is string => typeof x === 'string' && /^[a-f0-9]{64}$/u.test(x);
export const isSchemaName = (x: unknown): x is string =>
  typeof x === 'string' && /^[a-z][a-z0-9_]{0,62}$/u.test(x) && !x.startsWith('pg_');
export const isMigrationName = (x: unknown): x is string => typeof x === 'string' && /^\d{4}_[a-z0-9_]{1,54}\.sql$/u.test(x);
const literal = (x: unknown): x is PgLiteral => bounded(x, 1000) || typeof x === 'boolean'
  || (typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= Number.MAX_SAFE_INTEGER);

function isDefault(x: unknown): x is PgDefault {
  return isRecord(x) && (x.kind === 'literal' ? hasExactKeys(x, ['kind', 'value']) && literal(x.value)
    : (x.kind === 'current-date' || x.kind === 'current-timestamp') && hasExactKeys(x, ['kind']));
}

function isColumn(x: unknown): x is SchemaColumn {
  return isRecord(x) && hasExactKeys(x, Object.hasOwn(x, 'default') ? ['name', 'type', 'nullable', 'default'] : ['name', 'type', 'nullable'])
    && isSchemaName(x.name) && member(PG_TYPES, x.type) && typeof x.nullable === 'boolean'
    && (!Object.hasOwn(x, 'default') || isDefault(x.default));
}

function isConstraint(x: unknown): x is SchemaConstraint {
  if (!isRecord(x) || !isSchemaName(x.name)) return false;
  if (x.kind === 'check') return hasExactKeys(x, ['name', 'kind', 'column', 'operator', 'value', 'measure'])
    && isSchemaName(x.column) && member(CHECK_OPERATORS, x.operator) && literal(x.value)
    && (x.measure === 'value' || x.measure === 'length');
  if (!list(x.columns, SCHEMA_LIMITS.columns, isSchemaName) || !x.columns.length) return false;
  if (x.kind === 'foreign') return hasExactKeys(x, ['name', 'kind', 'columns', 'table', 'references', 'onDelete'])
    && isSchemaName(x.table) && list(x.references, SCHEMA_LIMITS.columns, isSchemaName) && x.references.length > 0
    && member(FK_ACTIONS, x.onDelete);
  return member(['primary', 'unique', 'index'], x.kind) && hasExactKeys(x, ['name', 'kind', 'columns']);
}

function isTable(x: unknown): x is SchemaTable {
  return isRecord(x) && hasExactKeys(x, ['name', 'columns', 'constraints']) && isSchemaName(x.name)
    && list(x.columns, SCHEMA_LIMITS.columns, isColumn) && list(x.constraints, SCHEMA_LIMITS.constraints, isConstraint);
}

export function isDatabaseSchema(x: unknown): x is DatabaseSchema {
  return isRecord(x) && hasExactKeys(x, ['version', 'tables']) && x.version === 1 && list(x.tables, SCHEMA_LIMITS.tables, isTable);
}

export const isSchemaSql = (x: unknown): x is string => bounded(x, SCHEMA_LIMITS.sql);
export function isCrudSelection(x: unknown): x is CrudSelection {
  return isRecord(x) && hasExactKeys(x, ['schema', 'migrations', 'backend', 'frontend'])
    && isDatabaseSchema(x.schema) && x.migrations === true
    && list(x.backend, SCHEMA_LIMITS.tables, isSchemaName) && list(x.frontend, SCHEMA_LIMITS.tables, isSchemaName);
}

const includesWorkspace = (x: Record<string, unknown>) => isProjectId(x.projectId) && digest(x.revision);
export const isSchemaEdit = (x: unknown): x is SchemaEdit => isRecord(x)
  && hasExactKeys(x, ['projectId', 'revision', 'schema']) && includesWorkspace(x) && isDatabaseSchema(x.schema);
export const isSqlImport = (x: unknown): x is SqlImport => isRecord(x)
  && hasExactKeys(x, ['sql', 'schema']) && isSchemaSql(x.sql) && isDatabaseSchema(x.schema);
export const isSchemaPublish = (x: unknown): x is SchemaWorkspace & { id: string } => isRecord(x)
  && hasExactKeys(x, ['projectId', 'revision', 'id']) && includesWorkspace(x) && isProjectId(x.id);

const coordinate = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 6000;
const point = (x: unknown): x is SchemaPoint => isRecord(x) && hasExactKeys(x, ['table', 'x', 'y'])
  && isSchemaName(x.table) && coordinate(x.x) && coordinate(x.y);
export const isSchemaPoints = (x: unknown): x is SchemaPoint[] => list(x, SCHEMA_LIMITS.tables, point)
  && new Set(x.map(({ table }) => table)).size === x.length;
export const isSchemaLayout = (x: unknown): x is SchemaLayout => isRecord(x)
  && hasExactKeys(x, ['projectId', 'revision', 'points']) && includesWorkspace(x) && isSchemaPoints(x.points);
export const isSchemaConnection = (x: unknown): x is SchemaConnection => isRecord(x)
  && hasExactKeys(x, ['projectId', 'revision', 'host', 'port', 'database', 'user', 'password', 'namespace'])
  && includesWorkspace(x) && bounded(x.host, 253) && /^[a-z0-9:-]+(?:\.[a-z0-9-]+)*$/iu.test(x.host)
  && typeof x.port === 'number' && Number.isInteger(x.port) && x.port > 0 && x.port <= 65535
  && isSchemaName(x.database) && isSchemaName(x.user) && isSchemaName(x.namespace)
  && bounded(x.password, 1024) && x.password.length > 0;
export function isSchemaDiagnostic(x: unknown): x is SchemaDiagnostic {
  return isRecord(x) && hasExactKeys(x, ['source', 'line', 'message']) && bounded(x.source, 150)
    && typeof x.line === 'number' && Number.isInteger(x.line) && x.line >= 0 && bounded(x.message, 300);
}
const diagnostics = (x: unknown) => list(x, SCHEMA_LIMITS.diagnostics, isSchemaDiagnostic);
export const isSchemaProposal = (x: unknown): x is SchemaProposal => isRecord(x)
  && hasExactKeys(x, ['schema', 'diagnostics']) && isDatabaseSchema(x.schema) && diagnostics(x.diagnostics);
const migration = (x: unknown): x is SchemaMigration => isRecord(x)
  && hasExactKeys(x, ['name', 'sql', 'sha256']) && isMigrationName(x.name) && isSchemaSql(x.sql) && digest(x.sha256);
export const isSchemaSnapshot = (x: unknown): x is SchemaSnapshot => isRecord(x)
  && hasExactKeys(x, ['schema', 'revision', 'migrations', 'diagnostics', 'layout', 'recovery']) && isDatabaseSchema(x.schema) && digest(x.revision)
  && list(x.migrations, SCHEMA_LIMITS.migrations, migration) && diagnostics(x.diagnostics) && isSchemaPoints(x.layout)
  && (x.recovery === null || (isRecord(x.recovery) && hasExactKeys(x.recovery, ['id', 'migration'])
    && isProjectId(x.recovery.id) && migration(x.recovery.migration)));
export const isNullableSchemaSnapshot = (x: unknown): x is SchemaSnapshot | null => x === null || isSchemaSnapshot(x);
export const isMigrationPreview = (x: unknown): x is MigrationPreview => isRecord(x) && hasExactKeys(x, ['id', 'migration', 'diagnostics'])
  && isProjectId(x.id) && (x.migration === null || migration(x.migration)) && diagnostics(x.diagnostics);
const applied = (x: unknown): x is SchemaPhysical['applied'][number] => isRecord(x)
  && hasExactKeys(x, ['name', 'sha256']) && bounded(x.name, 64) && bounded(x.sha256, 64);
export const isSchemaPhysical = (x: unknown): x is SchemaPhysical | null => x === null || (isRecord(x)
  && hasExactKeys(x, ['revision', 'target', 'schema', 'observedAt', 'applied', 'pending', 'diagnostics', 'differences'])
  && digest(x.revision) && bounded(x.target, 440) && bounded(x.observedAt, 30) && isDatabaseSchema(x.schema)
  && list(x.applied, SCHEMA_LIMITS.migrations, applied)
  && (x.pending === null || list(x.pending, SCHEMA_LIMITS.migrations, isMigrationName))
  && diagnostics(x.diagnostics) && list(x.differences, 2 * SCHEMA_LIMITS.tables, (v): v is string => bounded(v, 180)));
