import { CHECK_OPERATORS, isDatabaseSchema, isSchemaName, PG_TYPES, SCHEMA_LIMITS } from '@factory/contracts';
import type { DatabaseSchema, PgDefault, PgLiteral, PgType, SchemaColumn, SchemaConstraint, SchemaProposal, SchemaTable } from '@factory/contracts';
import { acceptsLiteral, diagnostic, emptySchema, orderedSchema, validateSchema } from './model';

interface Token { text: string; line: number }
class SqlDiagnostic extends Error {
  constructor(message: string, readonly line: number) { super(message); }
}

const numericTypes: readonly PgType[] = ['smallint', 'integer', 'bigint', 'numeric'];
const areNumeric = (left: PgType | undefined, right: PgType | undefined) =>
  left !== undefined && right !== undefined && numericTypes.includes(left) && numericTypes.includes(right);

function tokenize(source: string) {
  if (source.length > SCHEMA_LIMITS.sql) throw new SqlDiagnostic('SQL exceeds the import limit.', 1);
  const pattern = /\s+|--[^\n]*|\/\*[\s\S]*?\*\/|"(?:""|[^"])*"|e'(?:''|\\\\|[^'\\])*'|'(?:''|[^'])*'|[a-z_][a-z_0-9]*|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|<>|<=|>=|::|[\s(),;.=<>]/iy;
  const tokens: Token[] = [];
  let offset = 0;
  let line = 1;
  while (offset < source.length) {
    pattern.lastIndex = offset;
    const text = pattern.exec(source)?.[0];
    if (!text || text.includes('\0')) throw new SqlDiagnostic('Unsupported SQL token.', line);
    if (text.startsWith('/*') && text.indexOf('/*', 2) >= 0) throw new SqlDiagnostic('Nested block comments are unsupported.', line);
    if (!/^\s/u.test(text) && !text.startsWith('--') && !text.startsWith('/*')) {
      tokens.push({ text: /^[a-z_][a-z_0-9]*$/iu.test(text) ? text.toLowerCase() : text, line });
    }
    line += text.split('\n').length - 1;
    offset += text.length;
  }
  return tokens;
}

class Parser {
  #index = 0;
  constructor(private readonly tokens: readonly Token[]) {}

  get next() { return this.tokens[this.#index]?.text; }
  get line() { return (this.tokens[this.#index] ?? this.tokens.at(-1))?.line ?? 1; }

  error(message: string): never { throw new SqlDiagnostic(message, this.line); }
  take(text: string) {
    if (this.next !== text) return false;
    this.#index++;
    return true;
  }

  need(text: string) {
    if (!this.take(text)) this.error('Expected ' + text.toUpperCase() + ' in supported PostgreSQL DDL.');
  }

  name() {
    const text = this.next ?? '';
    const value = text.startsWith('"') ? text.slice(1, -1).replaceAll('""', '"') : text;
    if (!isSchemaName(value)) this.error('Expected a lowercase PostgreSQL identifier.');
    this.#index++;
    return value;
  }

  sequence<T>(read: () => T) {
    const values: T[] = [];
    this.need('(');
    do {
      if (values.length >= SCHEMA_LIMITS.columns + SCHEMA_LIMITS.constraints) this.error('SQL list exceeds the schema limit.');
      values.push(read());
    } while (this.take(','));
    this.need(')');
    return values;
  }

  type(): PgType {
    const text = this.name();
    if (text === 'timestamp') {
      if (this.take('with')) { this.need('time'); this.need('zone'); return 'timestamptz'; }
      if (this.take('without')) { this.need('time'); this.need('zone'); }
    }
    if (text === 'int' || text === 'int4') return 'integer';
    if (text === 'int8') return 'bigint';
    if (text === 'int2') return 'smallint';
    const supported = PG_TYPES.find((type) => type === text);
    if (!supported) this.error('This PostgreSQL data type is unsupported.');
    return supported;
  }

  value(): PgLiteral {
    const text = this.next ?? '';
    this.#index++;
    const escaped = /^[eE]'/u.test(text);
    if (escaped || text.startsWith("'")) {
      const raw = text.slice(escaped ? 2 : 1, -1).replaceAll("''", "'");
      const value = escaped ? raw.replaceAll('\\\\', '\\') : raw;
      if (value.length > 1000) this.error('A SQL literal exceeds the size limit.');
      return value;
    }
    if (text === 'true' || text === 'false') return text === 'true';
    if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/iu.test(text)) {
      const value = Number(text);
      if (Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER && (value !== 0 || !/[1-9]/u.test(text.split('e')[0]!))
        && (Number.isInteger(value) ? !text.includes('.') || /^-?\d+\.0+(?:e\+?0+)?$/iu.test(text)
          : text.split('e')[0]!.replace(/[^0-9]/gu, '').replace(/^0+/u, '').length <= 15)) return value;
    }
    return this.error('Expected a supported string, boolean or safely representable numeric literal.');
  }

  default(): PgDefault {
    if (this.take('current_date')) return { kind: 'current-date' };
    if (this.take('current_timestamp')) return { kind: 'current-timestamp' };
    if (this.take('now')) { this.need('('); this.need(')'); return { kind: 'current-timestamp' }; }
    return { kind: 'literal', value: this.value() };
  }

  check(catalogType?: (name: string) => PgType | undefined) {
    let depth = 0;
    while (this.take('(')) depth++;
    const qualified = this.take('pg_catalog');
    if (qualified) this.need('.');
    const measure = this.next === 'length' && (qualified || this.tokens[this.#index + 1]?.text === '(') ? 'length' : 'value';
    if (qualified && measure !== 'length') this.error('Only the built-in length() function is supported in check constraints.');
    if (measure === 'length') { this.need('length'); this.need('('); }
    const column = this.name();
    const columnCast = this.take('::') ? this.type() : undefined;
    if (measure === 'length') this.need(')');
    const operator = CHECK_OPERATORS.find((item) => item === this.next);
    if (!operator) this.error('Check constraints require a single supported comparison.');
    this.need(operator);
    const grouped = this.take('(');
    let value = this.value();
    let literalCast = this.take('::') ? this.type() : undefined;
    if (grouped) this.need(')');
    if (!literalCast && this.take('::')) literalCast = this.type();
    const type = catalogType?.(column);
    const operandType = measure === 'length' ? (catalogType ? 'integer' : undefined) : type;
    if ((columnCast && columnCast !== type) || (literalCast && literalCast !== operandType && !areNumeric(literalCast, operandType))) {
      this.error('Unsupported cast in a check constraint.');
    }
    if (literalCast && areNumeric(literalCast, operandType)) value = numericValue(value, literalCast);
    while (depth--) this.need(')');
    return { column, operator, value, measure } as const;
  }

  constraint(table: string, column?: string): SchemaConstraint {
    const explicit = this.take('constraint') ? this.name() : undefined;
    const fieldList = () => column ? [column] : this.sequence(() => this.name());
    const named = (fields: string[], suffix: string) => explicit ?? [table, ...fields, suffix].join('_').slice(0, 63);
    if (this.take('primary')) {
      this.need('key');
      return { name: named([], 'pkey'), kind: 'primary', columns: fieldList() };
    }
    if (this.take('unique')) {
      const columns = fieldList();
      return { name: named(columns, 'key'), kind: 'unique', columns };
    }
    if (this.take('check')) {
      if (this.next !== '(') this.error('A check expression needs parentheses.');
      const expression = this.check();
      return { name: named([expression.column], 'check'), kind: 'check', ...expression };
    }
    if (!column) { this.need('foreign'); this.need('key'); }
    const columns = fieldList();
    this.need('references');
    const target = this.name();
    const references = this.sequence(() => this.name());
    let onDelete: Extract<SchemaConstraint, { kind: 'foreign' }>['onDelete'] = 'no action';
    if (this.take('on')) {
      this.need('delete');
      if (this.take('no')) this.need('action');
      else if (this.take('set')) { this.need('null'); onDelete = 'set null'; }
      else if (this.take('cascade')) onDelete = 'cascade';
      else if (this.take('restrict')) onDelete = 'restrict';
      else this.error('Unsupported foreign key delete behavior.');
    }
    return { name: named(columns, 'fkey'), kind: 'foreign', columns, table: target, references, onDelete };
  }

  column(table: SchemaTable) {
    const column: SchemaColumn = { name: this.name(), type: this.type(), nullable: true };
    let nullability = false;
    for (;;) {
      if (this.take('not')) {
        if (nullability) this.error('Duplicate nullability rule.');
        this.need('null');
        nullability = true;
        column.nullable = false;
      } else if (this.take('null')) {
        if (nullability) this.error('Duplicate nullability rule.');
        nullability = true;
      } else if (this.take('default')) {
        if (column.default) this.error('Duplicate default.');
        column.default = this.default();
        if (this.take('::') && this.type() !== column.type) this.error('Default casts must match the column type.');
      } else if (['constraint', 'primary', 'unique', 'check', 'references'].includes(this.next ?? '')) {
        table.constraints.push(this.constraint(table.name, column.name));
      } else break;
    }
    table.columns.push(column);
  }

  apply(schema: DatabaseSchema) {
    const find = (name: string) => schema.tables.find((table) => table.name === name)
      ?? this.error('The referenced table must be defined before this statement.');
    while (this.next !== undefined) {
      if (this.take(';')) continue;
      if (this.take('create')) {
        if (this.take('table')) {
          const table: SchemaTable = { name: this.name(), columns: [], constraints: [] };
          this.sequence(() => {
            if (['constraint', 'primary', 'unique', 'check', 'foreign'].includes(this.next ?? '')) {
              table.constraints.push(this.constraint(table.name));
            } else this.column(table);
          });
          schema.tables.push(table);
        } else if (this.take('index')) {
          const name = this.name();
          this.need('on');
          const table = find(this.name());
          if (this.take('using')) this.need('btree');
          table.constraints.push({ name, kind: 'index', columns: this.sequence(() => this.name()) });
        } else this.error('Only CREATE TABLE and plain CREATE INDEX are supported.');
      } else if (this.take('alter')) {
        this.need('table');
        const table = find(this.name());
        this.need('add');
        if (this.take('column')) this.column(table);
        else table.constraints.push(this.constraint(table.name));
      } else this.error('Unsupported statement. Studio imports table, key, column, check and index DDL.');
      this.need(';');
      if (!isDatabaseSchema(schema)) this.error('The statement exceeds schema limits or contains an unsupported definition.');
    }
    for (const table of schema.tables) {
      for (const key of table.constraints.filter((constraint) => constraint.kind === 'primary')) {
        if (!('columns' in key)) continue;
        for (const column of table.columns) {
          if (key.columns.includes(column.name)) column.nullable = false;
        }
      }
    }
  }
}

export function parseSql(sql: string, previous = emptySchema(), source = 'SQL import'): SchemaProposal {
  try {
    const schema = orderedSchema(previous);
    // The clone keeps the reviewed source pristine when parsing fails later.
    const copy: DatabaseSchema = JSON.parse(JSON.stringify(schema));
    new Parser(tokenize(sql)).apply(copy);
    const checked = orderedSchema(copy);
    return { schema: checked, diagnostics: validateSchema(checked).map((item) => ({ ...item, source })) };
  } catch (error) {
    if (!(error instanceof SqlDiagnostic)) throw error;
    return { schema: previous, diagnostics: [diagnostic(error.message, source, error.line)] };
  }
}

function numericValue(input: PgLiteral, type: PgType) {
  if (typeof input === 'number' && acceptsLiteral(type, input)) return input;
  const parser = new Parser(tokenize(typeof input === 'string' ? input : ''));
  const value = parser.value();
  if (typeof value !== 'number' || parser.next !== undefined || !acceptsLiteral(type, value)) {
    parser.error('Numeric literal is unsupported.');
  }
  return value;
}

export function parseCatalogDefault(text: string, columnType: PgType): PgDefault | undefined {
  const parser = new Parser(tokenize(text));
  const grouped = parser.take('(');
  const value = parser.default();
  const cast = parser.take('::') ? parser.type() : undefined;
  if (grouped) parser.need(')');
  const target = cast ?? (parser.take('::') ? parser.type() : undefined);
  if (target && target !== columnType && !areNumeric(target, columnType)) parser.error('Default cast is unsupported.');
  if (parser.next !== undefined) parser.error('Default expression is unsupported.');
  // PostgreSQL deparses some numeric and boolean literals as cast text.
  if (value.kind === 'literal' && numericTypes.includes(columnType)) {
    const parsed = numericValue(value.value, target ?? columnType);
    if (!acceptsLiteral(columnType, parsed)) parser.error('Numeric default is outside the supported range.');
    return { kind: 'literal', value: parsed };
  }
  if (value.kind === 'literal' && typeof value.value === 'string') {
    if (columnType === 'boolean' && (value.value === 'true' || value.value === 'false')) return { kind: 'literal', value: value.value === 'true' };
  }
  return value;
}

export function parseCatalogCheck(text: string, columnType: (name: string) => PgType | undefined) {
  const parser = new Parser(tokenize(text));
  parser.need('check');
  const result = parser.check(columnType);
  if (parser.next !== undefined) parser.error('Check expression is unsupported.');
  return result;
}
