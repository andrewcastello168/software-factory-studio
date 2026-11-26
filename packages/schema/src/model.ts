import { isDatabaseSchema, SCHEMA_LIMITS } from '@factory/contracts';
import type { DatabaseSchema, PgLiteral, PgType, SchemaColumn, SchemaConstraint, SchemaDiagnostic, SchemaTable } from '@factory/contracts';

export function emptySchema(): DatabaseSchema {
  return { version: 1, tables: [] };
}

export function diagnostic(message: string, source = 'Schema', line = 0): SchemaDiagnostic {
  return { source, line, message: message.slice(0, 300) };
}

function isDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || value.startsWith('0000')) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().startsWith(value);
}

function normalizeTimestamp(value: string, withTimezone: boolean) {
  const date = value.slice(0, 10);
  if (!isDate(date)) return undefined;
  const parts = /^[T ]((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)(\.\d{1,6})?(Z|[+-](?:0\d|1[0-5])(?::?[0-5]\d)?)?$/u.exec(value.slice(10));
  const zone = parts?.[3];
  if (!parts || Boolean(zone) !== withTimezone) return undefined;
  const time = parts[1]!;
  const fraction = (parts[2] ?? '').replace(/0+$/u, '').replace(/\.$/u, '');
  if (!zone) return date + ' ' + time + fraction;
  const offset = zone.length === 3 ? zone + ':00' : zone;
  const instant = new Date(date + 'T' + time + offset);
  if (!Number.isFinite(instant.getTime())) return undefined;
  const utc = instant.toISOString();
  return isDate(utc.slice(0, 10)) ? utc.slice(0, 10) + ' ' + utc.slice(11, 19) + fraction + '+00' : undefined;
}

export function acceptsLiteral(type: PgType, value: PgLiteral) {
  switch (type) {
    case 'smallint': return typeof value === 'number' && Number.isInteger(value) && value >= -32768 && value <= 32767;
    case 'integer': return typeof value === 'number' && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
    case 'bigint': return typeof value === 'number' && Number.isSafeInteger(value);
    case 'numeric': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'text': return typeof value === 'string';
    case 'uuid': return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value);
    case 'date': return typeof value === 'string' && isDate(value);
    case 'timestamp':
    case 'timestamptz': return typeof value === 'string' && normalizeTimestamp(value, type === 'timestamptz') !== undefined;
    case 'jsonb': return typeof value === 'string' && /^(?:\{\s*\}|\[\s*\])$/u.test(value.trim());
  }
}

function normalizedLiteral(value: PgLiteral, type: PgType | undefined) {
  if (typeof value !== 'string') return value;
  if (type === 'timestamp' || type === 'timestamptz') return normalizeTimestamp(value, type === 'timestamptz') ?? value;
  if (type === 'uuid') return value.toLowerCase();
  if (type === 'jsonb') return value.replace(/\s+/gu, '');
  return value;
}

function validDefault({ default: value, type }: SchemaColumn) {
  if (!value) return true;
  if (value.kind === 'literal') return acceptsLiteral(type, value.value);
  if (value.kind === 'current-date') return type === 'date';
  return type === 'timestamp' || type === 'timestamptz';
}

const unique = (values: readonly string[]) => new Set(values).size === values.length;
const equal = (left: readonly string[], right: readonly string[]) =>
  left.length === right.length && left.every((item, index) => item === right[index]);
const isKey = (c: SchemaConstraint) => c.kind === 'primary' || c.kind === 'unique';
const reserved = new Set(['schema_migrations', 'tableoid', 'cmax', 'xmax', 'cmin', 'xmin', 'ctid']);

export function validateSchema(schema: DatabaseSchema): SchemaDiagnostic[] {
  if (!isDatabaseSchema(schema)) return [diagnostic('Invalid or excessive schema fields. Use lowercase PostgreSQL identifiers and the supported types.')];
  const errors: SchemaDiagnostic[] = [];
  const report = (message: string) => {
    if (errors.length < SCHEMA_LIMITS.diagnostics) errors.push(diagnostic(message));
  };
  const tableNames = schema.tables.map(({ name }) => name);
  const relationNames = new Set(tableNames);
  const byTable = new Map(schema.tables.map((table) => [table.name, table]));
  if (!unique(tableNames)) report('Table names must be unique.');
  for (const table of schema.tables) {
    const { name, columns, constraints } = table;
    if (reserved.has(name)) report(name + ' is a reserved table name.');
    if (!columns.length || !unique(columns.map((column) => column.name))) report(name + ' needs at least one column and unique column names.');
    if (!unique(constraints.map((constraint) => constraint.name))) report(name + ' has duplicate constraint or index names.');
    if (constraints.filter((constraint) => constraint.kind === 'primary').length > 1) report(name + ' has more than one primary key.');
    const byColumn = new Map(columns.map((column) => [column.name, column]));
    for (const column of columns) {
      if (reserved.has(column.name)) report(name + '.' + column.name + ' is reserved.');
      if (!validDefault(column)) report(name + '.' + column.name + ' has a default incompatible with ' + column.type + '.');
    }
    for (const constraint of constraints) {
      const label = name + '.' + constraint.name;
      if (reserved.has(constraint.name)) report(label + ' uses a reserved name.');
      if (constraint.kind === 'check') {
        const column = byColumn.get(constraint.column);
        const valid = column && (constraint.measure === 'length'
          ? column.type === 'text' && typeof constraint.value === 'number' && Number.isInteger(constraint.value)
          : column.type !== 'jsonb' && acceptsLiteral(column.type, constraint.value));
        if (!valid) report(label + ' has an incompatible check expression.');
        continue;
      }
      const fields = constraint.columns.map((column) => byColumn.get(column));
      if (fields.some((field) => !field) || !unique(constraint.columns)) {
        report(label + ' must use distinct columns from its table.');
      }
      if (constraint.kind === 'primary' && fields.some((column) => column?.nullable)) report(label + ' requires non-nullable columns.');
      if (constraint.kind !== 'foreign') {
        if (relationNames.has(constraint.name)) report(label + ' collides with a table, index or unique key name.');
        relationNames.add(constraint.name);
        continue;
      }
      const target = byTable.get(constraint.table);
      if (!target || !unique(constraint.references) || constraint.references.length !== fields.length
        || !target.constraints.some((key) => isKey(key) && 'columns' in key && equal(key.columns, constraint.references))) {
        report(label + ' must reference an existing primary or unique key in key order.');
      } else if (constraint.references.some((column, index) => fields[index]?.type !== target.columns.find(({ name }) => name === column)?.type)) {
        report(label + ' must reference columns of the same types.');
      }
      if (constraint.onDelete === 'set null' && fields.some((column) => !column?.nullable)) {
        report(label + ' uses SET NULL on a required column.');
      }
    }
  }
  return errors;
}

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function orderedSchema(schema: DatabaseSchema): DatabaseSchema {
  return {
    version: 1,
    tables: [...schema.tables].sort((a, b) => order(a.name, b.name)).map((table) => ({
      name: table.name,
      columns: table.columns.map(({ name, type, nullable, default: value }) => ({
        name, type, nullable, ...(value ? {
          default: value.kind === 'literal' ? { kind: value.kind, value: normalizedLiteral(value.value, type) } : { kind: value.kind },
        } : {}),
      })),
      constraints: [...table.constraints].sort((a, b) => order(a.name, b.name)).map((constraint) => {
        const { name, kind } = constraint;
        if (kind === 'check') {
          const type = constraint.measure === 'value' ? columnOf(table, constraint.column)?.type : undefined;
          return { name, kind, column: constraint.column, measure: constraint.measure, operator: constraint.operator, value: normalizedLiteral(constraint.value, type) };
        }
        if (kind === 'foreign') return { name, kind, columns: constraint.columns, table: constraint.table, references: constraint.references, onDelete: constraint.onDelete };
        return { name, kind, columns: constraint.columns };
      }),
    })),
  };
}

export function compareSchemas(declared: DatabaseSchema, physical: DatabaseSchema): string[] {
  const source = orderedSchema(declared).tables;
  const target = orderedSchema(physical).tables;
  const differences: string[] = [];
  for (const table of source) {
    const observed = target.find(({ name }) => name === table.name);
    if (!observed) differences.push(table.name + ' is missing from the physical schema.');
    else if (JSON.stringify(table) !== JSON.stringify(observed)) differences.push(table.name + ' has different columns or constraints.');
  }
  for (const table of target) {
    if (!source.some(({ name }) => name === table.name)) differences.push(table.name + ' exists only in the physical schema.');
  }
  return differences;
}

export const columnOf = (table: SchemaTable, name: string) => table.columns.find((column) => column.name === name);
