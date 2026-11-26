import type { CrudSelection, PgType } from '@factory/contracts';
import { columnOf, diagnostic, validateSchema } from './model';

export const CRUD_TYPES: readonly PgType[] = ['smallint', 'integer', 'text', 'boolean', 'uuid', 'date'];

export function validateCrud(input: CrudSelection) {
  const errors = validateSchema(input.schema);
  if (errors.length) return errors;
  if (!input.schema.tables.length) return [diagnostic('Define at least one table for the schema migration.')];
  for (const options of [input.backend, input.frontend]) {
    if (new Set(options).size !== options.length) return [diagnostic('Select each table once for each CRUD layer.')];
  }
  if (input.frontend.some((table) => !input.backend.includes(table))) {
    return [diagnostic('Each selected React page requires the generated API for the same table.')];
  }
  for (const name of input.backend) {
    const table = input.schema.tables.find((table) => table.name === name);
    if (!table) return [diagnostic('The selected table does not exist in the schema.')];
    const primary = table.constraints.find((key) => key.kind === 'primary');
    if (!primary || !('columns' in primary) || primary.columns.length !== 1) {
      return [diagnostic(name + ' needs a single-column primary key for CRUD.')];
    }
    const key = columnOf(table, primary.columns[0]!)!;
    if (key.type === 'boolean' || key.type === 'date' || table.columns.some(({ type }) => !CRUD_TYPES.includes(type))) {
      return [diagnostic(name + ' uses a column or primary-key type unsupported by CRUD.')];
    }
  }
  return [];
}
