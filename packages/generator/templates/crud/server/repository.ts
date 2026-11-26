import type { Pool } from 'pg';
import type { Row, Scalar, Table } from './contracts.ts';

const identifier = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const parameters = (count: number) => Array.from({ length: count }, (_item, index) => '$' + (index + 1)).join(', ');

export function repository(pool: Pool, table: Table) {
  // Names come only from generated, validated descriptors. Values use parameters.
  const relation = identifier(table.name);
  const key = identifier(table.key);
  const columns = table.columns.map(({ name, type }) => {
    const field = identifier(name);
    return type === 'date' ? "pg_catalog.to_char(" + field + ", 'YYYY-MM-DD') AS " + field : field;
  }).join(', ');
  const filter = table.columns.map(({ name }) => 'pg_catalog.strpos(pg_catalog.lower(' + identifier(name)
    + '::text), pg_catalog.lower($1)) > 0').join(' OR ');
  return {
    async list({ q, limit, offset }: { q: string; limit: number; offset: number }) {
      const result = await pool.query<Row>('SELECT ' + columns + ' FROM ' + relation + ' WHERE $1 = \'\' OR (' + filter + ')'
        + ' ORDER BY ' + key + ' LIMIT $2 OFFSET $3', [q, limit + 1, offset]);
      return { rows: result.rows.slice(0, limit), hasMore: result.rows.length > limit };
    },
    async get(id: Scalar) {
      const { rows } = await pool.query<Row>('SELECT ' + columns + ' FROM ' + relation + ' WHERE ' + key + ' = $1', [id]);
      return rows[0] ?? null;
    },
    async create(fields: Row) {
      const names = Object.keys(fields);
      const clause = names.length ? '(' + names.map(identifier).join(', ') + ') VALUES (' + parameters(names.length) + ')' : 'DEFAULT VALUES';
      const { rows } = await pool.query<Row>('INSERT INTO ' + relation + ' ' + clause + ' RETURNING ' + columns, Object.values(fields));
      return rows[0]!;
    },
    async update(id: Scalar, fields: Row) {
      const entries = Object.entries(fields);
      const assignments = entries.map(([name], index) => identifier(name) + ' = $' + (index + 2)).join(', ');
      const { rows } = await pool.query<Row>('UPDATE ' + relation + ' SET ' + assignments + ' WHERE ' + key + ' = $1 RETURNING ' + columns,
        [id, ...entries.map(([, value]) => value)]);
      return rows[0] ?? null;
    },
    async remove(id: Scalar) {
      const result = await pool.query('DELETE FROM ' + relation + ' WHERE ' + key + ' = $1', [id]);
      return result.rowCount === 1;
    },
  };
}
