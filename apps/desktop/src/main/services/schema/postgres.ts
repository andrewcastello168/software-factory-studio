import pg from 'pg';
import type { Client } from 'pg';
import { isDatabaseSchema, isSchemaName, SCHEMA_LIMITS } from '@factory/contracts';
import type { PgType, SchemaColumn, SchemaConnection, SchemaConstraint, SchemaDiagnostic, SchemaMigration, SchemaPhysical, SchemaTable } from '@factory/contracts';
import { compareSchemas, diagnostic, emptySchema, identifier, orderedSchema, parseCatalogCheck, parseCatalogDefault, validateSchema } from '@factory/schema';
import { modelSources } from './source';

const maximumColumns = SCHEMA_LIMITS.tables * SCHEMA_LIMITS.columns;
const maximumConstraints = SCHEMA_LIMITS.tables * SCHEMA_LIMITS.constraints;
export function isLoopback(host: string) { return host === '127.0.0.1' || host === '::1'; }
export function isDevelopmentTarget(input: SchemaConnection) {
  return isLoopback(input.host) && (input.database === 'factory_check' || input.database.startsWith('factory_dev_'))
    && input.namespace !== 'information_schema';
}

export const targetLabel = (input: SchemaConnection) =>
  (input.host.includes(':') ? '[' + input.host + ']' : input.host) + ':' + input.port + '/' + input.database + ' · ' + input.namespace;

const catalogType = new Map<string, PgType>([
  ['int2', 'smallint'], ['int4', 'integer'], ['int8', 'bigint'], ['text', 'text'], ['bool', 'boolean'],
  ['date', 'date'], ['timestamp', 'timestamp'], ['timestamptz', 'timestamptz'], ['uuid', 'uuid'], ['numeric', 'numeric'], ['jsonb', 'jsonb'],
]);

interface CatalogColumn {
  table_name: string; kind: string; partitioned: boolean; row_security: boolean; trigger: boolean; inherited: boolean;
  column_name: string | null; type_name: string | null; builtin: boolean; type_modifier: number; nullable: boolean;
  special: boolean; default_sql: string | null;
}
interface CatalogConstraint {
  table_name: string; name: string; kind: string; definition: string; target: string | null;
  namespace: string | null; columns: string[]; references: string[];
  delete_action: string; unsupported: boolean;
}
interface CatalogIndex { table_name: string; name: string; columns: string[]; supported: boolean }

async function physicalModel(client: Client, namespace: string) {
  const diagnostics: SchemaDiagnostic[] = [];
  const log = (message: string) => {
    if (diagnostics.length < SCHEMA_LIMITS.diagnostics) diagnostics.push(diagnostic(message, 'PostgreSQL catalog'));
  };
  // Every query uses catalog names fixed in Studio. The selected namespace is a parameter.
  const { rows: columns } = await client.query<CatalogColumn>(`
    SELECT c.relname AS table_name, c.relkind AS kind, c.relispartition AS partitioned, c.relrowsecurity AS row_security,
      EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS trigger,
      EXISTS (SELECT 1 FROM pg_catalog.pg_inherits i WHERE i.inhrelid = c.oid OR i.inhparent = c.oid) AS inherited,
      a.attname AS column_name, t.typname AS type_name, nt.nspname = 'pg_catalog' AS builtin,
      a.atttypmod AS type_modifier, NOT a.attnotnull AS nullable,
      a.attidentity <> '' OR a.attgenerated <> '' OR a.attndims <> 0
        OR a.attcollation <> t.typcollation AS special,
      CASE WHEN d.adbin IS NOT NULL THEN pg_catalog.pg_get_expr(d.adbin, d.adrelid) END AS default_sql
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      AND c.relkind IN ('r','p','f')
    LEFT JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_catalog.pg_namespace nt ON nt.oid = t.typnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    WHERE n.nspname = $1 AND c.relkind IN ('r','p','f','v','m','S') AND c.relname <> 'schema_migrations'
    ORDER BY c.relname COLLATE "C", a.attnum LIMIT $2
  `, [namespace, maximumColumns + 1]);
  if (columns.length > maximumColumns) log('The physical schema exceeds the column inspection limit.');
  const tables = new Map<string, SchemaTable>();
  for (const row of columns) {
    if (!isSchemaName(row.table_name) || row.kind !== 'r' || row.partitioned || row.row_security || row.trigger || row.inherited) {
      log('A physical relation has an unsupported name, kind, inheritance, trigger or row policy.');
      continue;
    }
    if (!tables.has(row.table_name)) {
      if (tables.size >= SCHEMA_LIMITS.tables) { log('The physical schema exceeds the table inspection limit.'); break; }
      tables.set(row.table_name, { name: row.table_name, columns: [], constraints: [] });
    }
    const table = tables.get(row.table_name)!;
    const type = row.type_name && catalogType.get(row.type_name);
    if (!isSchemaName(row.column_name) || !type || !row.builtin || row.type_modifier !== -1 || row.special
      || table.columns.length >= SCHEMA_LIMITS.columns) {
      log(table.name + ' contains an unsupported column, type modifier or generated expression.');
      continue;
    }
    const column: SchemaColumn = { name: row.column_name, type, nullable: row.nullable };
    if (row.default_sql) {
      try {
        const value = parseCatalogDefault(row.default_sql, type);
        if (value) column.default = value;
      } catch { log(table.name + '.' + column.name + ' has an unsupported default expression.'); }
    }
    table.columns.push(column);
  }

  const { rows: constraints } = await client.query<CatalogConstraint>(`
    SELECT c.relname AS table_name, k.conname AS name, k.contype AS kind,
      pg_catalog.pg_get_constraintdef(k.oid) AS definition,
      target.relname AS target, tn.nspname AS namespace, k.confdeltype AS delete_action,
      k.condeferrable OR NOT k.convalidated OR (k.contype = 'c' AND k.connoinherit) OR (k.contype = 'f' AND
        (k.confupdtype <> 'a' OR k.confmatchtype <> 's' OR k.confdelsetcols IS NOT NULL))
        OR COALESCE(idx.indnullsnotdistinct, false) AS unsupported,
      ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(k.conkey) WITH ORDINALITY AS x(num, pos)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = x.num ORDER BY x.pos) AS columns,
      ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(k.confkey) WITH ORDINALITY AS x(num, pos)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = k.confrelid AND a.attnum = x.num ORDER BY x.pos) AS references
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_catalog.pg_class target ON target.oid = k.confrelid
      LEFT JOIN pg_catalog.pg_namespace tn ON tn.oid = target.relnamespace
      LEFT JOIN pg_catalog.pg_index idx ON idx.indexrelid = k.conindid
    WHERE n.nspname = $1 AND c.relname <> 'schema_migrations'
    ORDER BY c.relname, k.conname LIMIT $2
  `, [namespace, maximumConstraints + 1]);
  const deleteActions = new Map<string, Extract<SchemaConstraint, { kind: 'foreign' }>['onDelete']>([
    ['a', 'no action'], ['r', 'restrict'], ['c', 'cascade'], ['n', 'set null'],
  ]);
  if (constraints.length > maximumConstraints) log('The physical schema exceeds the constraint inspection limit.');
  for (const row of constraints) {
    const table = tables.get(row.table_name);
    if (!table) continue;
    if (!isSchemaName(row.name) || row.unsupported || table.constraints.length >= SCHEMA_LIMITS.constraints
      || row.columns.some((column) => !isSchemaName(column))) { log(table.name + ' has an unsupported constraint.'); continue; }
    if (row.kind === 'p' || row.kind === 'u') {
      table.constraints.push({ name: row.name, kind: row.kind === 'p' ? 'primary' : 'unique', columns: row.columns });
    } else if (row.kind === 'c') {
      try {
        const check = parseCatalogCheck(row.definition, (name) => table.columns.find((column) => column.name === name)?.type);
        table.constraints.push({ name: row.name, kind: 'check', ...check });
      }
      catch { log(table.name + '.' + row.name + ' has an unsupported check expression.'); }
    } else {
      const onDelete = deleteActions.get(row.delete_action);
      if (row.kind === 'f' && onDelete && row.namespace === namespace && isSchemaName(row.target)
        && row.references.every(isSchemaName)) {
        table.constraints.push({ name: row.name, kind: 'foreign', columns: row.columns, table: row.target, references: row.references, onDelete });
      } else log(table.name + '.' + row.name + ' uses an unsupported constraint or cross-schema reference.');
    }
  }

  const { rows: indexes } = await client.query<CatalogIndex>(`
    SELECT c.relname AS table_name, i.relname AS name,
      ARRAY(SELECT a.attname::text FROM pg_catalog.unnest(idx.indkey) WITH ORDINALITY AS x(num, pos)
        JOIN pg_catalog.pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = x.num ORDER BY x.pos) AS columns,
      idx.indisvalid AND pg_catalog.pg_get_indexdef(i.oid) =
        'CREATE INDEX ' || pg_catalog.quote_ident(i.relname) || ' ON ' || pg_catalog.quote_ident(n.nspname) ||
        '.' || pg_catalog.quote_ident(c.relname) || ' USING btree (' ||
        (SELECT pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' ORDER BY x.pos)
          FROM pg_catalog.unnest(idx.indkey) WITH ORDINALITY AS x(num, pos)
          JOIN pg_catalog.pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = x.num) || ')' AS supported
    FROM pg_catalog.pg_index idx JOIN pg_catalog.pg_class c ON c.oid = idx.indrelid
      JOIN pg_catalog.pg_class i ON i.oid = idx.indexrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname <> 'schema_migrations'
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conindid = idx.indexrelid AND k.contype IN ('p','u','x'))
    ORDER BY c.relname, i.relname LIMIT $2
  `, [namespace, maximumConstraints + 1]);
  if (indexes.length > maximumConstraints) log('The physical schema exceeds the index inspection limit.');
  for (const row of indexes) {
    const table = tables.get(row.table_name);
    if (!table) continue;
    if (!row.supported || !isSchemaName(row.name) || row.columns.some((name) => !isSchemaName(name))
      || table.constraints.length >= SCHEMA_LIMITS.constraints) log(table.name + ' uses an unsupported index.');
    else table.constraints.push({ name: row.name, kind: 'index', columns: row.columns });
  }

  const model = { version: 1, tables: [...tables.values()] } as const;
  if (!isDatabaseSchema(model)) {
    log('Some catalog objects cannot be represented by the supported schema model.');
    return { schema: emptySchema(), diagnostics };
  }
  for (const item of validateSchema(model)) log(item.message);
  return { schema: orderedSchema(model), diagnostics };
}

const ledgerTable = (namespace: string) => identifier(namespace) + '.schema_migrations';

async function readLedger(client: Client, namespace: string) {
  const { rows } = await client.query<{ valid: boolean }>(`
    SELECT c.relkind = 'r' AND NOT c.relispartition AND NOT c.relrowsecurity
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid = c.oid)
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) = 2
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_attribute a
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped AND a.attname IN ('name','checksum')
          AND a.atttypid = 'pg_catalog.text'::pg_catalog.regtype AND a.attnotnull AND a.attgenerated = '' AND a.attidentity = '') = 2
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
        WHERE k.conrelid = c.oid AND k.contype = 'p' AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (name)') AS valid
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = $1 AND c.relname = 'schema_migrations'
  `, [namespace]);
  if (!rows.length) return { applied: [], exists: false, valid: true };
  if (!rows[0]?.valid) return { applied: [], exists: true, valid: false };
  const entries = await client.query<{ name: string; sha256: string }>(
    'SELECT name, checksum AS sha256 FROM ' + ledgerTable(namespace) + ' ORDER BY name COLLATE "C" LIMIT $1', [SCHEMA_LIMITS.migrations + 1],
  );
  if (entries.rows.length > SCHEMA_LIMITS.migrations || entries.rows.some(({ name, sha256 }) => name.length > 64 || sha256.length > 64)) {
    return { applied: [], exists: true, valid: false };
  }
  return { applied: entries.rows, exists: true, valid: true };
}

async function observe(client: Client, input: SchemaConnection, migrations: SchemaMigration[], sourceComplete: boolean) {
  const { schema, diagnostics } = await physicalModel(client, input.namespace);
  const ledger = await readLedger(client, input.namespace);
  const matches = ledger.valid && ledger.applied.every((row, index) =>
    row.name === migrations[index]?.name && row.sha256 === migrations[index]?.sha256);
  if (!matches) diagnostics.unshift(diagnostic('The applied migration history differs from the source sequence or checksums.', 'PostgreSQL ledger'));
  const declared = modelSources(migrations).schema;
  const pending = matches && sourceComplete ? migrations.slice(ledger.applied.length).map(({ name }) => name) : null;
  const result: SchemaPhysical = {
    revision: input.revision, target: targetLabel(input), schema, observedAt: new Date().toISOString(),
    diagnostics: diagnostics.slice(0, SCHEMA_LIMITS.diagnostics), applied: ledger.applied, pending,
    differences: sourceComplete ? compareSchemas(declared, schema) : [],
  };
  return { result, ledger };
}

export async function observeDatabase(
  input: SchemaConnection, migrations: SchemaMigration[], sourceComplete: boolean, apply: boolean,
  authorize: () => Promise<void>, expected?: SchemaPhysical,
) {
  if (input.namespace === 'information_schema' || (apply && !isDevelopmentTarget(input))) throw new Error('Invalid database target.');
  const config = {
    host: input.host, port: input.port, database: input.database, user: input.user, password: input.password,
    ssl: isLoopback(input.host) ? false : { rejectUnauthorized: true },
    connectionTimeoutMillis: 3500, statement_timeout: 4500, query_timeout: 5500, lock_timeout: 3500,
    application_name: 'Software Factory Studio', options: '-c standard_conforming_strings=on -c DateStyle=ISO,YMD -c TimeZone=UTC',
    enableChannelBinding: true,
  };
  const client = new pg.Client(config);
  // Idle transport failures have no user-visible details or credentials.
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query(apply ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SET LOCAL search_path TO pg_catalog');
    const target = await client.query<{ found: boolean; major: number }>(`
      SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1) AS found,
        pg_catalog.current_setting('server_version_num')::int / 10000 AS major
    `, [input.namespace]);
    if (!target.rows[0]?.found || target.rows[0].major < 15 || target.rows[0].major > 17) throw new Error('Unsupported database or namespace.');
    if (apply) {
      await client.query('SELECT pg_catalog.pg_advisory_xact_lock(60543121)');
      await authorize();
    }
    const before = await observe(client, input, migrations, sourceComplete);
    if (!apply) {
      await client.query('COMMIT');
      return before.result;
    }
    const applied = modelSources(migrations.slice(0, before.ledger.applied.length));
    const full = modelSources(migrations);
    if (!expected || JSON.stringify(before.result.applied) !== JSON.stringify(expected.applied)
      || JSON.stringify(before.result.pending) !== JSON.stringify(expected.pending) || before.result.pending === null || before.result.diagnostics.length || !full.safe
      || applied.diagnostics.length || compareSchemas(applied.schema, before.result.schema).length) {
      throw new Error('Unsupported migrations, history conflict or database drift.');
    }
    if (before.result.pending.length) {
      await client.query('SET LOCAL search_path TO ' + identifier(input.namespace) + ', pg_temp');
      if (!before.ledger.exists) {
        await client.query('CREATE TABLE ' + ledgerTable(input.namespace) + ' (name text PRIMARY KEY, checksum text NOT NULL)');
      }
      for (const migration of migrations.slice(before.ledger.applied.length)) {
        await client.query(migration.sql);
        await client.query('INSERT INTO ' + ledgerTable(input.namespace) + ' (name, checksum) VALUES ($1, $2)', [migration.name, migration.sha256]);
      }
      await client.query('SET LOCAL search_path TO pg_catalog');
    }
    const after = await observe(client, input, migrations, sourceComplete);
    if (after.result.pending?.length !== 0 || after.result.diagnostics.length || after.result.differences.length) {
      throw new Error('The applied database differs from the reviewed source.');
    }
    await authorize();
    await client.query('COMMIT');
    return after.result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end().catch(() => undefined);
  }
}
