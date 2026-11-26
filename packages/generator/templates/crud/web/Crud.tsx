import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Row, Scalar, Table } from '../../../server/features/crud/contracts.ts';
import './crud.css';

const tables: readonly Table[] = @@CRUDWEBDEFINITIONS@@;
const title = (name: string) => name.split('_').map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' ');
const endpoint = (table: Table, id?: Scalar) => '/api/crud/' + table.name
  + (id === undefined ? '' : '/record?' + new URLSearchParams({ id: String(id) }));
const pageSize = 25;

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const value: { data?: T; error?: { message?: string } } = await response.json();
  if (!response.ok || value.data === undefined) throw new Error(value.error?.message ?? 'The request failed.');
  return value.data;
}

function Records({ table }: { table: Table }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<{ row: Row | null; fields: Row }>();
  const [deleting, setDeleting] = useState<Row>();

  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ q: filter, limit: String(pageSize), offset: String(page * pageSize) });
    request<{ rows: Row[]; hasMore: boolean }>(endpoint(table) + '?' + params, { signal: abort.signal }).then((data) => {
      if (abort.signal.aborted) return;
      setRows(data.rows);
      setMore(data.hasMore);
    }).catch((failure: unknown) => {
      if (!abort.signal.aborted) {
        setRows([]);
        setMore(false);
        setError(failure instanceof Error ? failure.message : 'Could not load records.');
      }
    }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [table, page, filter, refresh]);

  function reload() { setLoading(true); setRefresh((value) => value + 1); }

  async function mutate(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    setStatus('');
    try {
      if (deleting) {
        await request(endpoint(table, deleting[table.key]!), { method: 'DELETE' });
        setDeleting(undefined);
        setStatus('Record deleted.');
      } else if (editing) {
        await request(endpoint(table, editing.row?.[table.key]), {
          method: editing.row ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing.fields),
        });
        setStatus(editing.row ? 'Record updated.' : 'Record created.');
        setEditing(undefined);
      }
      reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not save the record.');
    } finally { setSaving(false); }
  }

  return <>
    <div className="crud-toolbar">
      <form onSubmit={(event) => {
        event.preventDefault(); setFilter(query); setPage(0); setError(''); reload();
      }}>
        <label>Filter records <input value={query} maxLength={150} onChange={(event) => setQuery(event.target.value)} /></label>
        <button>Apply Filter</button>
      </form>
      <button disabled={saving || Boolean(editing || deleting)} onClick={() => {
        setEditing({ row: null, fields: {} }); setStatus(''); setError('');
      }}>New Record</button>
    </div>
    {error && <p role="alert">{error}</p>}
    {status && <p role="status">{status}</p>}
    {deleting && <section className="crud-editor" aria-label="Confirm record deletion">
      <p>Delete record <strong>{String(deleting[table.key])}</strong>?</p>
      <button disabled={saving} onClick={() => setDeleting(undefined)}>Cancel</button>
      <button disabled={saving} onClick={() => void mutate()}>Delete Record</button>
    </section>}
    {editing && <form className="crud-editor" aria-label={editing.row ? 'Edit record' : 'Create record'} onSubmit={(event) => void mutate(event)}>
      <h3>{editing.row ? 'Edit record' : 'New record'}</h3>
      <div className="crud-fields">{table.columns.filter(({ name }) => !editing.row || table.key !== name).map((field) => {
        const present = Object.hasOwn(editing.fields, field.name);
        const value = present ? editing.fields[field.name] : editing.row?.[field.name];
        const optional = field.nullable || field.hasDefault;
        const update = (next: Scalar | undefined) => setEditing((current) => {
          if (!current) return current;
          const fields = { ...current.fields };
          if (next === undefined) delete fields[field.name];
          else Object.defineProperty(fields, field.name, { value: next, enumerable: true, configurable: true, writable: true });
          return { ...current, fields };
        });
        return <div key={field.name} className="crud-field">
          <label>{title(field.name)}
            {field.type === 'boolean'
              ? <select value={value == null ? '' : String(value)} required={!optional} disabled={saving} onChange={(event) => {
                update(event.target.value === '' ? undefined : event.target.value === 'true');
              }}><option value="">Select…</option><option value="true">True</option><option value="false">False</option></select>
              : <input value={value == null ? '' : String(value)} disabled={saving}
                type={field.type === 'date' ? 'date' : field.type === 'integer' || field.type === 'smallint' ? 'number' : 'text'}
                required={!optional && field.type !== 'text'} maxLength={4000}
                onChange={(event) => {
                  const raw = event.target.value;
                  const numeric = field.type === 'integer' || field.type === 'smallint';
                  update(!raw && field.type !== 'text' ? undefined : numeric ? Number(raw) : raw);
                }} />}
          </label>
          {field.nullable && <label className="crud-null"><input type="checkbox" checked={value === null} disabled={saving}
            onChange={(event) => update(event.target.checked ? null : undefined)} /> Set null</label>}
        </div>;
      })}</div>
      <button type="button" disabled={saving} onClick={() => setEditing(undefined)}>Cancel</button>
      <button disabled={saving || Boolean(editing.row && !Object.keys(editing.fields).length)}>{saving ? 'Saving…' : 'Save Record'}</button>
    </form>}
    {loading ? <p role="status">Loading records…</p> : rows.length ? <div className="crud-overflow">
      <table><thead><tr>{table.columns.map(({ name }) => <th key={name} scope="col">{title(name)}</th>)}<th scope="col">Actions</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={String(row[table.key])}>
          {table.columns.map(({ name }) => <td key={name}>{row[name] == null ? '—' : String(row[name])}</td>)}
          <td><button disabled={saving || Boolean(editing || deleting)} onClick={() => {
            setEditing({ row, fields: {} }); setError(''); setStatus('');
          }}>Edit</button><button disabled={saving || Boolean(editing || deleting)} onClick={() => {
            setDeleting(row); setError(''); setStatus('');
          }}>Delete</button></td>
        </tr>)}</tbody>
      </table>
    </div> : !error && <p>No matching records.</p>}
    <div className="crud-toolbar">
      <button disabled={loading || page === 0} onClick={() => { setLoading(true); setPage(page - 1); }}>Previous</button>
      <span>Page {page + 1}</span>
      <button disabled={loading || !more || (page + 1) * pageSize > 10000} onClick={() => { setLoading(true); setPage(page + 1); }}>Next</button>
    </div>
  </>;
}

export function CrudWorkspace() {
  const [active, setActive] = useState(tables[0]!.name);
  const table = tables.find(({ name }) => name === active)!;
  return <section className="crud-workspace" aria-labelledby="records-title">
    <h2 id="records-title">Records</h2>
    <p>This application has unauthenticated data routes. Deploy it with appropriate network and access controls.</p>
    <label>Table <select value={active} onChange={(event) => setActive(event.target.value)}>
      {tables.map(({ name }) => <option key={name} value={name}>{title(name)}</option>)}
    </select></label>
    <Records key={active} table={table} />
  </section>;
}
