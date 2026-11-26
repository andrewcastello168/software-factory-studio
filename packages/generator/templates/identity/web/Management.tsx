import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { request } from './client.ts';
import type { PageData } from './client.ts';

export function usePage<T>(path: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [revision, bump] = useState(0);
  const refresh = useCallback(() => bump((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    request<PageData<T>>(path + '?' + new URLSearchParams({ q: filter, offset: String(offset) }), 'GET', undefined, controller.signal)
      .then(({ rows, hasMore }) => { if (!controller.signal.aborted) { setRows(rows); setMore(hasMore); setError(''); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) { setRows([]); setMore(false); setError(cause instanceof Error ? cause.message : 'Unable to load records.'); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, filter, offset, revision, refresh]);
  const move = (step: number) => { setLoading(true); setOffset(offset + step); };
  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setLoading(true); setOffset(0); setFilter(String(new FormData(event.currentTarget).get('filter') ?? '')); refresh();
  };
  const controls = <>
    <form className="identity-bar" onSubmit={search}><label>Filter<input name="filter" maxLength={100} /></label><button>Search</button></form>
    <button disabled={loading || offset === 0} onClick={() => move(-50)}>Previous</button>
    <button disabled={loading || !more || offset >= 10_000} onClick={() => move(50)}>Next</button>
  </>;
  return { rows, error, loading, refresh, controls };
}

export function Grid({ headers, rows }: { headers: string[]; rows: { id: string; cells: ReactNode[] }[] }) {
  if (!rows.length) return <p>No matching records.</p>;
  return <div className="identity-grid"><table><thead><tr>{headers.map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead>
    <tbody>{rows.map(({ id, cells }) => <tr key={id}>{cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

export function useAction(refresh: () => void) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(job: () => Promise<unknown>) {
    setBusy(true); setError('');
    try { await job(); refresh(); return true; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The operation failed.'); return false; }
    finally { setBusy(false); }
  }
  return { busy, error, run };
}
