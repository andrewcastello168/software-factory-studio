import { Grid, usePage } from './Management.tsx';

interface AuditRow { id: string; actor_id: string | null; target_id: string | null; action: string; resource: string; occurred_at: string }
export function AuditLog() {
  const page = usePage<AuditRow>('/audit');
  return <section className="identity-admin"><h1>Audit log</h1>{page.controls}
    {page.error && <p role="alert">{page.error}</p>}
    {page.loading ? <p role="status">Loading audit events…</p> : <Grid headers={['Time', 'Action', 'Resource', 'Actor', 'Target']}
      rows={page.rows.map((event) => ({ id: event.id, cells: [new Date(event.occurred_at).toLocaleString(), event.action, event.resource,
        event.actor_id ?? '—', event.target_id ?? '—'] }))} />}
  </section>;
}
