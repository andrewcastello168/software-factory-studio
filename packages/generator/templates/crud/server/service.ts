import type { Pool } from 'pg';
import type { Table } from './contracts.ts';
import { repository } from './repository.ts';
import { listOptions, recordBody, recordKey } from './validation.ts';

export function service(pool: Pool, table: Table) {
  const records = repository(pool, table);
  return {
    list: (query: Record<string, unknown>) => records.list(listOptions(query)),
    get: (id: unknown) => records.get(recordKey(table, id)),
    create: (value: unknown) => records.create(recordBody(table, value, false)),
    update: (id: unknown, value: unknown) => records.update(recordKey(table, id), recordBody(table, value, true)),
    remove: (id: unknown) => records.remove(recordKey(table, id)),
  };
}
