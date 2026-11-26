import type { Field, Row, Scalar, Table } from './contracts.ts';

export class InvalidInput extends Error {}

function validate(field: Field, input: unknown): Scalar {
  if (input === null && field.nullable) return null;
  const fail = () => new InvalidInput('Provide a valid ' + field.type + ' value for ' + field.name + '.');
  switch (field.type) {
    case 'smallint':
    case 'integer': {
      const limit = field.type === 'smallint' ? 32768 : 2147483648;
      if (typeof input === 'number' && Number.isInteger(input) && input >= -limit && input < limit) return input;
      break;
    }
    case 'boolean': if (typeof input === 'boolean') return input;
      break;
    case 'uuid': if (typeof input === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu.test(input)) return input;
      break;
    case 'date': {
      if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(input) || input.startsWith('0000')) break;
      const date = new Date(input + 'T00:00:00Z');
      if (Number.isFinite(date.getTime()) && date.toISOString().startsWith(input)) return input;
      break;
    }
    case 'text': if (typeof input === 'string' && input.length <= 4000 && !input.includes('\0')) return input;
      break;
  }
  throw fail();
}

export function recordKey(table: Table, raw: unknown) {
  const key = table.columns.find(({ name }) => name === table.key)!;
  if (typeof raw !== 'string') throw new InvalidInput('Provide exactly one record ID.');
  if (key.type === 'smallint' || key.type === 'integer') {
    if (!/^-?\d{1,10}$/u.test(raw)) throw new InvalidInput('Provide an integer record ID.');
    return validate(key, Number(raw));
  }
  return validate(key, raw);
}

export function recordBody(table: Table, raw: unknown, update: boolean): Row {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new InvalidInput('Provide a JSON object.');
  const input = raw as Record<string, unknown>;
  const fields = new Map(table.columns.map((column) => [column.name, column]));
  const values: [string, Scalar][] = [];
  for (const [name, value] of Object.entries(input)) {
    const field = fields.get(name);
    if (!field || (update && name === table.key)) throw new InvalidInput('The request contains an unknown or read-only field.');
    values.push([name, validate(field, value)]);
  }
  if (update && !values.length) throw new InvalidInput('Provide at least one field to update.');
  if (!update) {
    const missing = table.columns.find((field) => !field.nullable && !field.hasDefault && !Object.hasOwn(input, field.name));
    if (missing) throw new InvalidInput('Provide a value for ' + missing.name + '.');
  }
  return Object.fromEntries(values);
}

function number(raw: unknown, fallback: number, upper: number, minimum: number) {
  if (raw === undefined) return fallback;
  if (typeof raw === 'string' && /^\d{1,5}$/u.test(raw) && Number(raw) >= minimum && Number(raw) <= upper) return Number(raw);
  throw new InvalidInput('Provide valid pagination values.');
}

export function listOptions(query: Record<string, unknown>) {
  const { q = '', limit, offset } = query;
  if (Object.keys(query).some((name) => !['q', 'limit', 'offset'].includes(name))
    || typeof q !== 'string' || q.length > 150 || q.includes('\0')) throw new InvalidInput('Provide a valid list filter.');
  return { q, limit: number(limit, 25, 100, 1), offset: number(offset, 0, 10000, 0) };
}
