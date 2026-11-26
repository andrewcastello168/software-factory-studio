import { SCHEMA_LIMITS } from '@factory/contracts';
import type { DatabaseSchema, PgDefault, PgLiteral, SchemaColumn, SchemaConstraint } from '@factory/contracts';
import { diagnostic, orderedSchema, validateSchema } from './model';

export const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
export function literalSql(value: PgLiteral) {
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  const escape = value.includes('\\');
  const escaped = escape ? value.replaceAll('\\', '\\\\') : value;
  return (escape ? "E'" : "'") + escaped.replaceAll("'", "''") + "'";
}
const names = (values: string[]) => '(' + values.map(identifier).join(', ') + ')';
const defaultSql = (value: PgDefault) => value.kind === 'literal' ? literalSql(value.value)
  : value.kind === 'current-date' ? 'CURRENT_DATE' : 'CURRENT_TIMESTAMP';
const columnSql = (column: SchemaColumn) => identifier(column.name) + ' ' + column.type
  + (column.nullable ? '' : ' NOT NULL') + (column.default ? ' DEFAULT ' + defaultSql(column.default) : '');

function constraintSql(constraint: Exclude<SchemaConstraint, { kind: 'index' }>) {
  const prefix = 'CONSTRAINT ' + identifier(constraint.name) + ' ';
  switch (constraint.kind) {
    case 'primary': return prefix + 'PRIMARY KEY ' + names(constraint.columns);
    case 'unique': return prefix + 'UNIQUE ' + names(constraint.columns);
    case 'check': {
      const column = identifier(constraint.column);
      const operand = constraint.measure === 'length' ? 'pg_catalog.length(' + column + ')' : column;
      return prefix + 'CHECK (' + operand + ' ' + constraint.operator + ' ' + literalSql(constraint.value) + ')';
    }
    case 'foreign': return prefix + 'FOREIGN KEY ' + names(constraint.columns) + ' REFERENCES '
      + identifier(constraint.table) + ' ' + names(constraint.references)
      + (constraint.onDelete === 'no action' ? '' : ' ON DELETE ' + constraint.onDelete.toUpperCase());
  }
}

export function planMigration(before: DatabaseSchema, after: DatabaseSchema): { sql: string; diagnostics: ReturnType<typeof validateSchema> } {
  const diagnostics = [...validateSchema(before), ...validateSchema(after)].slice(0, SCHEMA_LIMITS.diagnostics);
  if (diagnostics.length) return { sql: '', diagnostics };
  const source = orderedSchema(before).tables;
  const desired = orderedSchema(after).tables;
  const changes: string[] = [];
  const keys: string[] = [];
  const relations: string[] = [];
  const indexes: string[] = [];
  const block = (message: string) => {
    if (diagnostics.length < SCHEMA_LIMITS.diagnostics) diagnostics.push(diagnostic(message));
  };
  for (const previous of source) {
    const current = desired.find(({ name }) => name === previous.name);
    if (!current) {
      block(previous.name + ' would be removed or renamed. Publish a separately reviewed migration outside Studio.');
      continue;
    }
    if (!previous.columns.every((column, index) => JSON.stringify(column) === JSON.stringify(current.columns[index]))) {
      block(previous.name + ' changes, removes or reorders existing columns. Studio publishes additive migrations.');
    }
    for (const constraint of previous.constraints) {
      if (!current.constraints.some((item) => JSON.stringify(item) === JSON.stringify(constraint))) {
        block(previous.name + '.' + constraint.name + ' changes or removes an existing constraint.');
      }
    }
  }
  for (const table of desired) {
    const previous = source.find(({ name }) => name === table.name);
    const name = identifier(table.name);
    if (!previous) changes.push('CREATE TABLE ' + name + ' (\n  ' + table.columns.map(columnSql).join(',\n  ') + '\n);');
    else {
      for (const column of table.columns.slice(previous.columns.length)) {
        if (!column.nullable && !column.default) block(table.name + '.' + column.name + ' needs a default or must be nullable for an existing table.');
        changes.push('ALTER TABLE ' + name + ' ADD COLUMN ' + columnSql(column) + ';');
      }
    }
    for (const constraint of table.constraints) {
      if (previous?.constraints.some((old) => old.name === constraint.name)) continue;
      if (constraint.kind === 'index') {
        indexes.push('CREATE INDEX ' + identifier(constraint.name) + ' ON ' + name + ' ' + names(constraint.columns) + ';');
      } else {
        const statement = 'ALTER TABLE ' + name + ' ADD ' + constraintSql(constraint) + ';';
        (constraint.kind === 'foreign' ? relations : keys).push(statement);
      }
    }
  }
  const statements = [...changes, ...keys, ...relations, ...indexes];
  const sql = statements.length ? statements.join('\n\n') + '\n' : '';
  if (sql.length > SCHEMA_LIMITS.sql) block('The migration exceeds the size limit. Split the schema changes.');
  return { sql: diagnostics.length ? '' : sql, diagnostics };
}
