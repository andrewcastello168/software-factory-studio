import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compareSchemas, emptySchema, parseSql, planMigration, validateCrud, validateSchema } from './index';

const inventory = readFileSync(new URL('../../../tests/fixtures/inventory.sql', import.meta.url), 'utf8');

describe('PostgreSQL schema model', () => {
  it('deterministically round-trips inventory and orders keys before cyclic references and indexes', () => {
    const { schema, diagnostics } = parseSql(inventory);
    expect(diagnostics).toEqual([]);
    expect(schema.tables).toHaveLength(5);
    const plan = planMigration(emptySchema(), schema);
    expect(plan.diagnostics).toEqual([]);
    expect(plan.sql.indexOf('CREATE TABLE "warehouses"')).toBeLessThan(plan.sql.indexOf('FOREIGN KEY'));
    expect(plan.sql.indexOf('UNIQUE')).toBeLessThan(plan.sql.indexOf('FOREIGN KEY'));
    expect(plan.sql.lastIndexOf('CREATE INDEX')).toBeGreaterThan(plan.sql.lastIndexOf('FOREIGN KEY'));
    expect(parseSql(plan.sql)).toEqual({ schema, diagnostics: [] });
    expect(planMigration(emptySchema(), { ...schema, tables: [...schema.tables].reverse() })).toEqual(plan);
    expect(compareSchemas(schema, emptySchema())).toHaveLength(5);
  });

  it('validates composite and cyclic keys, nullability, incompatible defaults and references', () => {
    const { schema, diagnostics } = parseSql(`
      CREATE TABLE parent (id integer, scope text, child_id integer, PRIMARY KEY (id, scope));
      CREATE TABLE child (id integer PRIMARY KEY, parent_id integer, parent_scope text);
      ALTER TABLE parent ADD FOREIGN KEY (child_id) REFERENCES child (id);
      ALTER TABLE child ADD FOREIGN KEY (parent_id, parent_scope) REFERENCES parent (id, scope) ON DELETE SET NULL;
    `);
    expect(diagnostics).toEqual([]);
    expect(planMigration(emptySchema(), schema).diagnostics).toEqual([]);
    expect(validateCrud({ schema, migrations: true, backend: ['parent'], frontend: [] })[0]?.message).toContain('single-column');
    expect(validateCrud({ schema, migrations: true, backend: [], frontend: ['child'] })[0]?.message).toContain('requires');
    expect(parseSql('CREATE TABLE example (id integer DEFAULT \'invalid\');').diagnostics[0]?.message).toContain('default');
    expect(parseSql('CREATE TABLE example (id text REFERENCES parent (id));', schema).diagnostics[0]?.message).toContain('primary or unique');
    schema.tables[0]!.columns.find(({ name }) => name === 'parent_id')!.nullable = false;
    expect(validateSchema(schema)[0]?.message).toContain('SET NULL');
  });

  it('keeps imports atomic and refuses destructive or unsupported input', () => {
    const { schema } = parseSql(inventory);
    for (const sql of [
      'CREATE TABLE safe (id integer);\nDROP TABLE products;',
      'SELECT pg_sleep(1);', 'CREATE TABLE inv (amount numeric(9,2));',
      'CREATE TABLE "Mixed" (id integer);', 'CREATE INDEX i ON products (lower(name));',
      'CREATE TABLE log (id text CHECK (id IS NOT NULL));',
      'CREATE TABLE log (id integer GENERATED ALWAYS AS IDENTITY);',
      'ALTER TABLE products ADD CONSTRAINT invalid_fk FOREIGN KEY (id) REFERENCES another_schema.products (id);',
      '/* a /* b */ c */ CREATE TABLE audit (id integer);',
    ]) {
      const result = parseSql(sql, schema);
      expect(result.diagnostics.length, sql).toBeGreaterThan(0);
      expect(result.schema, sql).toBe(schema);
    }
    expect(parseSql('CREATE TABLE safe (id integer);\nDROP TABLE products;', schema).diagnostics[0]?.line).toBe(2);
    expect(planMigration(schema, emptySchema()).diagnostics[0]?.message).toContain('removed');
    const next = parseSql('ALTER TABLE products ADD COLUMN note text DEFAULT \'O\'\'Reilly\';', schema);
    expect(next.diagnostics).toEqual([]);
    expect(planMigration(schema, next.schema).sql).toContain("DEFAULT 'O''Reilly'");
  });
});
