import { useState } from 'react';
import { KeyRound, Link2, Plus, Table2, Trash2 } from 'lucide-react';
import { CHECK_OPERATORS, FK_ACTIONS, isSchemaName, PG_TYPES, SCHEMA_LIMITS } from '@factory/contracts';
import type { DatabaseSchema, PgDefault, PgLiteral, PgType, SchemaColumn, SchemaConstraint, SchemaDiagnostic, SchemaTable } from '@factory/contracts';
import { acceptsLiteral, validateSchema } from '@factory/schema';
import { Button, Dialog, IconButton, Input } from '../Controls';

export function Diagnostics({ items }: { items: SchemaDiagnostic[] }) {
  if (!items.length) return null;
  return <ul role="alert" className="schema-diagnostics">{items.map(({ source, line, message }, index) =>
    <li key={index}><bdi>{source}{line > 0 ? ':' + line : ''}</bdi><span>{message}</span></li>)}</ul>;
}

function parseInput(text: string, type: PgType): PgLiteral {
  if (type === 'boolean') {
    if (text === 'true' || text === 'false') return text === 'true';
  } else if (['smallint', 'integer', 'bigint', 'numeric'].includes(type)) {
    if (text.trim() && /^-?\d+(?:\.\d+)?$/u.test(text)) {
      const number = Number(text);
      if (acceptsLiteral(type, number)) return number;
    }
  } else if (acceptsLiteral(type, text)) return text;
  throw new Error('Enter a valid ' + type + ' literal.');
}

function ColumnDialog({ column, table, close, save }: {
  column?: SchemaColumn; table: SchemaTable; close: () => void; save: (value: SchemaColumn) => void;
}) {
  const [name, setName] = useState(column?.name ?? '');
  const [type, setType] = useState<PgType>(column?.type ?? 'text');
  const [nullable, setNullable] = useState(column?.nullable ?? true);
  const [mode, setMode] = useState<PgDefault['kind'] | 'none'>(column?.default?.kind ?? 'none');
  const [literal, setLiteral] = useState(column?.default?.kind === 'literal' ? String(column.default.value) : '');
  const [error, setError] = useState('');
  return <Dialog title={column ? 'Edit Column' : 'Add Column'} onClose={close}>
    <form className="schema-form" onSubmit={(event) => {
      event.preventDefault();
      if (!isSchemaName(name) || table.columns.some((item) => item !== column && item.name === name)) {
        setError('Use a unique lowercase column name beginning with a letter.'); return;
      }
      try {
        const value: PgDefault | undefined = mode === 'literal' ? { kind: mode, value: parseInput(literal, type) }
          : mode === 'none' ? undefined : { kind: mode };
        if ((mode === 'current-date' && type !== 'date')
          || (mode === 'current-timestamp' && !['timestamp', 'timestamptz'].includes(type))) {
          setError('Choose a default compatible with ' + type + '.'); return;
        }
        save({ name, type, nullable, ...(value ? { default: value } : {}) });
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid column.'); }
    }}>
      <label>Column name<Input data-dialog-focus required value={name} maxLength={63} onChange={(event) => setName(event.target.value)} /></label>
      <label>PostgreSQL type<select value={type} onChange={(event) => setType(PG_TYPES[event.target.selectedIndex] ?? 'text')}>
        {PG_TYPES.map((value) => <option key={value}>{value}</option>)}
      </select></label>
      <label className="schema-check"><input type="checkbox" checked={nullable} onChange={(event) => setNullable(event.target.checked)} /> Nullable</label>
      <label>Default<select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}>
        <option value="none">None</option><option value="literal">Literal</option>
        <option value="current-date">Current date</option><option value="current-timestamp">Current timestamp</option>
      </select></label>
      {mode === 'literal' && <label>Default value<Input value={literal} maxLength={1000} onChange={(event) => setLiteral(event.target.value)} /></label>}
      {error && <p role="alert" className="schema-error">{error}</p>}
      <div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary">Save Column</Button></div>
    </form>
  </Dialog>;
}

const constraints = [
  { value: 'primary', label: 'Primary key' }, { value: 'foreign', label: 'Foreign key' },
  { value: 'unique', label: 'Unique' }, { value: 'check', label: 'Check' }, { value: 'index', label: 'Index' },
] as const;
const listNames = (input: string) => input.split(',').map((item) => item.trim());
const fieldSize = 1000;

function ConstraintDialog({ table, tables, close, save }: {
  table: SchemaTable; tables: SchemaTable[]; close: () => void; save: (value: SchemaConstraint) => void;
}) {
  const [kind, setKind] = useState<SchemaConstraint['kind']>('primary');
  const [name, setName] = useState('');
  const [columns, setColumns] = useState('');
  const [target, setTarget] = useState(tables[0]?.name ?? '');
  const [references, setReferences] = useState('');
  const [onDelete, setOnDelete] = useState<typeof FK_ACTIONS[number]>('no action');
  const [column, setColumn] = useState(table.columns[0]?.name ?? '');
  const [operator, setOperator] = useState<typeof CHECK_OPERATORS[number]>('=');
  const [measure, setMeasure] = useState<'value' | 'length'>('value');
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  return <Dialog title="Add Constraint or Index" onClose={close}>
    <form className="schema-form" onSubmit={(event) => {
      event.preventDefault();
      if (!isSchemaName(name) || table.constraints.some((item) => item.name === name)) {
        setError('Use a unique lowercase constraint name beginning with a letter.'); return;
      }
      try {
        if (kind === 'check') {
          const type = table.columns.find((field) => field.name === column)?.type;
          if (!type) throw new Error('Select a column.');
          save({ name, kind, column, operator, measure, value: parseInput(value, measure === 'length' ? 'integer' : type) });
        } else {
          const fields = listNames(columns);
          if (!fields.every((field) => table.columns.some((item) => item.name === field)) || new Set(fields).size !== fields.length) {
            throw new Error('Specify distinct existing columns in key order.');
          }
          if (kind === 'foreign') {
            const keys = listNames(references);
            if (keys.length !== fields.length || !keys.every(isSchemaName)) throw new Error('Specify one referenced column for each local column.');
            save({ name, kind, columns: fields, table: target, references: keys, onDelete });
          } else save({ name, kind, columns: fields });
        }
      } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invalid constraint.'); }
    }}>
      <label>Kind<select value={kind} onChange={(event) => setKind(constraints[event.target.selectedIndex]?.value ?? 'primary')}>
        {constraints.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Name<Input data-dialog-focus value={name} required maxLength={63} onChange={(event) => setName(event.target.value)} /></label>
      {kind === 'check' ? <>
        <label>Column<select value={column} onChange={(event) => setColumn(event.target.value)}>
          {table.columns.map(({ name }) => <option key={name}>{name}</option>)}
        </select></label>
        <label>Compare<select value={measure} onChange={(event) => setMeasure(event.target.value === 'length' ? 'length' : 'value')}>
          <option value="value">Column value</option><option value="length">Text length</option>
        </select></label>
        <label>Operator<select value={operator} onChange={(event) => setOperator(CHECK_OPERATORS[event.target.selectedIndex] ?? '=')}>
          {CHECK_OPERATORS.map((op) => <option key={op}>{op}</option>)}
        </select></label>
        <label>Compare with<Input value={value} maxLength={1000} onChange={(event) => setValue(event.target.value)} /></label>
      </> : <label>Columns in key order<Input required value={columns} maxLength={fieldSize} onChange={(event) => setColumns(event.target.value)} />
        <small>Separate column names with a comma.</small></label>}
      {kind === 'foreign' && <>
        <label>Referenced table<select value={target} onChange={(event) => setTarget(event.target.value)}>
          {tables.map(({ name }) => <option key={name}>{name}</option>)}
        </select></label>
        <label>Referenced columns<Input required value={references} maxLength={fieldSize} onChange={(event) => setReferences(event.target.value)} /></label>
        <label>On delete<select value={onDelete} onChange={(event) => setOnDelete(FK_ACTIONS[event.target.selectedIndex] ?? 'no action')}>
          {FK_ACTIONS.map((action) => <option key={action}>{action}</option>)}
        </select></label>
      </>}
      {error && <p role="alert" className="schema-error">{error}</p>}
      <div className="dialog-actions"><Button onClick={close}>Cancel</Button><Button type="submit" variant="primary">Add Constraint</Button></div>
    </form>
  </Dialog>;
}

export function showConstraint(constraint: SchemaConstraint) {
  if (constraint.kind === 'check') return (constraint.measure === 'length' ? 'length(' + constraint.column + ')' : constraint.column)
    + ' ' + constraint.operator + ' ' + JSON.stringify(constraint.value);
  return constraint.columns.join(', ') + (constraint.kind === 'foreign' ? ' → ' + constraint.table + '(' + constraint.references.join(', ') + ')' : '');
}

export function SchemaDesigner({ schema, selected, select, onChange, readOnly = false }: {
  schema: DatabaseSchema; selected: string; select: (name: string) => void; onChange: (value: DatabaseSchema) => void; readOnly?: boolean;
}) {
  const [newTable, setNewTable] = useState('');
  const [error, setError] = useState('');
  const [columnDialog, setColumnDialog] = useState<SchemaColumn | 'new'>();
  const [keyDialog, setKeyDialog] = useState(false);
  const table = schema.tables.find(({ name }) => name === selected) ?? schema.tables[0];
  const update = (next: SchemaTable) => onChange({ ...schema, tables: schema.tables.map((item) => item === table ? next : item) });
  const check = (kind: 'primary' | 'foreign', name: string) => table?.constraints.some((item) => item.kind === kind && item.columns.includes(name));
  return <div className="schema-designer">
    <aside aria-label="Schema tables" className="schema-tree">
      <header><strong>Tables</strong><span>{schema.tables.length}</span></header>
      {!readOnly && <form onSubmit={(event) => {
        event.preventDefault();
        if (!isSchemaName(newTable) || schema.tables.some(({ name }) => name === newTable)) {
          setError('Use a unique lowercase table name beginning with a letter.'); return;
        }
        onChange({ ...schema, tables: [...schema.tables, { name: newTable, columns: [], constraints: [] }] });
        select(newTable); setNewTable(''); setError('');
      }}>
        <Input aria-label="New table name" placeholder="table_name" value={newTable} maxLength={63} onChange={(event) => { setNewTable(event.target.value); setError(''); }} />
        <IconButton type="submit" label="Add Table" disabled={!newTable || schema.tables.length >= SCHEMA_LIMITS.tables}><Plus size={15} /></IconButton>
      </form>}
      {error && <p role="alert" className="schema-error">{error}</p>}
      <ul>{schema.tables.map(({ name }) => <li key={name}><Button aria-pressed={table?.name === name} title={name} onClick={() => select(name)}>
        <Table2 size={15} aria-hidden="true" /><span>{name}</span>
      </Button></li>)}</ul>
    </aside>
    {table ? <section className="schema-inspector" aria-label={'Table ' + table.name}>
      <header><h3>{table.name}</h3>{!readOnly && <IconButton label={'Remove ' + table.name + ' from draft'} onClick={() => {
        onChange({ ...schema, tables: schema.tables.filter((item) => item !== table) }); select('');
      }}><Trash2 size={15} /></IconButton>}</header>
      <div className="schema-subheading"><h4>Columns</h4>{!readOnly && <Button disabled={table.columns.length >= SCHEMA_LIMITS.columns} onClick={() => setColumnDialog('new')}><Plus size={14} />Add Column</Button>}</div>
      {table.columns.length ? <div className="schema-table-scroll"><table><thead><tr>
        <th scope="col">Column</th><th scope="col">Type</th><th scope="col">Nullable</th><th scope="col">Default</th>{!readOnly && <th scope="col">Actions</th>}
      </tr></thead><tbody>{table.columns.map((column) => <tr key={column.name}>
        <td><span className="schema-column-name">{check('primary', column.name) && <KeyRound aria-label="Primary key" size={13} />}
          {check('foreign', column.name) && <Link2 aria-label="Foreign key" size={13} />}{column.name}</span></td>
        <td>{column.type}</td><td>{column.nullable ? 'Yes' : 'No'}</td>
        <td className="schema-value" title={column.default?.kind === 'literal' ? String(column.default.value) : column.default?.kind}>
          {column.default?.kind === 'literal' ? JSON.stringify(column.default.value) : column.default?.kind ?? '—'}</td>
        {!readOnly && <td className="schema-actions-cell"><Button onClick={() => setColumnDialog(column)}>Edit</Button>
          <IconButton label={'Remove column ' + column.name} onClick={() => update({ ...table, columns: table.columns.filter((item) => item !== column) })}><Trash2 size={13} /></IconButton></td>}
      </tr>)}</tbody></table></div> : <p className="schema-muted">Define at least one column for this table.</p>}
      <div className="schema-subheading"><h4>Constraints and indexes</h4>{!readOnly && <Button
        disabled={!table.columns.length || table.constraints.length >= SCHEMA_LIMITS.constraints} onClick={() => setKeyDialog(true)}><Plus size={14} />Add Constraint</Button>}</div>
      {table.constraints.length ? <ul className="schema-constraints">{table.constraints.map((constraint) =>
        <li key={constraint.name}><span>{constraints.find(({ value }) => value === constraint.kind)?.label}</span><code>{constraint.name}</code>
          <small>{showConstraint(constraint)}</small>
          {!readOnly && <IconButton label={'Remove ' + constraint.name} onClick={() => update({ ...table, constraints: table.constraints.filter((item) => item !== constraint) })}><Trash2 size={13} /></IconButton>}
        </li>)}</ul> : <p className="schema-muted">No constraints or indexes defined.</p>}
      {!readOnly && columnDialog && <ColumnDialog table={table} {...(columnDialog === 'new' ? {} : { column: columnDialog })}
        close={() => setColumnDialog(undefined)} save={(column) => {
          update({ ...table, columns: columnDialog === 'new' ? [...table.columns, column] : table.columns.map((item) => item === columnDialog ? column : item) });
          setColumnDialog(undefined);
        }} />}
      {!readOnly && keyDialog && <ConstraintDialog table={table} tables={schema.tables} close={() => setKeyDialog(false)} save={(constraint) => {
        update({
          ...table, constraints: [...table.constraints, constraint],
          columns: constraint.kind === 'primary' ? table.columns.map((column) => constraint.columns.includes(column.name)
            ? { ...column, nullable: false } : column) : table.columns,
        });
        setKeyDialog(false);
      }} />}
    </section> : <p className="schema-empty">No tables. Add a table or import PostgreSQL DDL to begin.</p>}
  </div>;
}

export function DraftDiagnostics({ schema }: { schema: DatabaseSchema }) {
  return <Diagnostics items={validateSchema(schema)} />;
}
