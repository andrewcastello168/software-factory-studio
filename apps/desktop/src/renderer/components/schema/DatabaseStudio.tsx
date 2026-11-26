import { useCallback, useEffect, useState } from 'react';
import { Database, FileCode, GitCompareArrows, Network, RefreshCw, Table2 } from 'lucide-react';
import { isSchemaConnection, SCHEMA_LIMITS, stackDefinition } from '@factory/contracts';
import type {
  DatabaseSchema, ErrorCode, MigrationPreview, OpenProject, Result, SchemaConnection, SchemaMigration, SchemaPhysical, SchemaPoint, SchemaSnapshot,
} from '@factory/contracts';
import { browserPreview } from '../../usePreferences';
import { Button, Dialog, Input } from '../Controls';
import { Diagnostics, DraftDiagnostics, SchemaDesigner } from './Designer';
import { Diagram } from './Diagram';

export const schemaBridge = browserPreview ? undefined : window.studio?.schema;
export const supportsDatabaseStudio = (project: OpenProject | undefined) => project?.metadata.status === 'managed'
  && project.metadata.descriptor.profileId === stackDefinition(project.metadata.descriptor.stackId)?.architecture;

const errors: Partial<Record<ErrorCode, string>> = {
  ACCESS_DENIED: 'Open this project again to authorize Database Studio.',
  SCHEMA_UNAVAILABLE: 'Studio could not safely read the PostgreSQL migration directory for this project.',
  SCHEMA_STALE: 'The workspace, Git branch, or files changed. Refresh the source and review a new plan.',
  SCHEMA_CONFLICT: 'This action is blocked by the schema, Git state, target, or a previous review. Check the source and database details.',
  SCHEMA_STORAGE: 'Studio could not read or save its local schema state.',
  SCHEMA_DATABASE: 'PostgreSQL could not complete this operation. Check the target, permissions, migration history, and schema drift. No database details were logged.',
  GENERATOR_RECOVERY: 'A migration publication needs recovery. Refresh the source and review the saved operation.',
  PROJECT_BUSY: 'Another Git or schema operation is in progress.',
};

const views = [
  { id: 'schema', label: 'Schema', icon: Table2 },
  { id: 'diagram', label: 'ERD', icon: Network },
  { id: 'migrations', label: 'Migrations', icon: FileCode },
  { id: 'physical', label: 'Physical database', icon: GitCompareArrows },
] as const;

type View = typeof views[number]['id'];
function migrationStatus(migration: SchemaMigration, physical: SchemaPhysical | undefined) {
  if (!physical) return 'Source';
  const record = physical.applied.find(({ name }) => name === migration.name);
  if (record) return record.sha256 === migration.sha256 ? 'Applied' : 'Checksum mismatch';
  return physical.pending?.includes(migration.name) ? 'Pending' : 'Unknown';
}

type Run = <T>(label: string, work: () => Promise<Result<T>>, accept: (value: T) => void) => Promise<void>;

function Connection({ snapshot, project, physical, busy, error, run, onResult }: {
  snapshot: SchemaSnapshot; project: OpenProject; physical: SchemaPhysical | undefined; busy: boolean; error: string; run: Run;
  onResult: (value: SchemaPhysical | null) => void;
}) {
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('5432');
  const [database, setDatabase] = useState('');
  const [namespace, setNamespace] = useState('public');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [observedUser, setObservedUser] = useState('');
  const [databaseSelection, setDatabaseSelection] = useState('');
  const [applyReview, setApplyReview] = useState(false);
  const input: SchemaConnection = { projectId: project.id, revision: snapshot.revision, host, port: Number(port), namespace, database, user, password };
  const target = (host.includes(':') ? '[' + host + ']' : host) + ':' + Number(port) + '/' + database + ' · ' + namespace;
  const current = physical?.revision === snapshot.revision && physical.target === target && observedUser === user;
  const valid = isSchemaConnection(input);
  const canApply = current && Boolean(physical?.pending?.length) && !physical?.diagnostics.length
    && !snapshot.diagnostics.length && !snapshot.recovery && (host === '127.0.0.1' || host === '::1')
    && (database === 'factory_check' || database.startsWith('factory_dev_'));

  function request(apply: boolean) {
    if (!schemaBridge || !valid) return;
    const bridge = schemaBridge;
    setPassword('');
    void run(apply ? 'Applying reviewed migrations…' : 'Inspecting read-only…',
      () => apply ? bridge.apply(input) : bridge.physical(input), (result) => {
        if (result) { setObservedUser(input.user); onResult(result); setApplyReview(false); }
      });
  }

  const pending = snapshot.migrations.filter(({ name }) => physical?.pending?.includes(name));
  const shown = pending.find(({ name }) => name === databaseSelection) ?? pending[0];
  return <div className="schema-physical">
    <form autoComplete="off" className="schema-connection" onSubmit={(event) => { event.preventDefault(); request(false); }}>
      <div className="schema-subheading"><h3>PostgreSQL connection</h3></div>
      <p className="schema-muted">Inspection uses a read-only transaction. Studio clears the password after each request.</p>
      <div className="schema-fields">
        <label>Host<Input value={host} onChange={(event) => setHost(event.target.value)} maxLength={253} required /></label>
        <label>Port<Input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(event.target.value)} required /></label>
        <label>Database<Input value={database} onChange={(event) => setDatabase(event.target.value)} maxLength={63} required /></label>
        <label>Schema namespace<Input value={namespace} onChange={(event) => setNamespace(event.target.value)} maxLength={63} required /></label>
        <label>User<Input value={user} onChange={(event) => setUser(event.target.value)} maxLength={63} required /></label>
        <label>Password<Input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} maxLength={1024} required /></label>
      </div>
      <div className="schema-tool-actions">
        <Button type="submit" variant="primary" disabled={!valid || busy}>Inspect Database</Button>
        {canApply && <Button className="outlined-button" disabled={busy} onClick={() => setApplyReview(true)}>Review Development Apply</Button>}
      </div>
    </form>
    {physical ? <section className="schema-observation" aria-label="Physical database snapshot">
      <header><h3>Observed schema</h3><bdi>{physical.target}</bdi><small>{new Date(physical.observedAt).toLocaleString()}</small></header>
      {!current && <p className="schema-warning" role="status">This observation is stale for the selected source revision or connection fields.</p>}
      <div className="schema-physical-summary">
        <span>{physical.schema.tables.length} observed tables</span>
        <span>{physical.applied.length} applied migrations</span>
        <span>{physical.pending === null ? 'Pending status unknown' : physical.pending.length + ' pending migrations'}</span>
      </div>
      <Diagnostics items={physical.diagnostics} />
      {physical.differences.length > 0 && <section className="schema-difference"><h4>Source and catalog differences</h4>
        <ul>{physical.differences.map((difference) => <li key={difference}>{difference}</li>)}</ul></section>}
      <details className="schema-difference"><summary>Physical tables and columns</summary>
        {physical.schema.tables.map((table) => <p key={table.name}><code>{table.name}</code> · {table.columns.map(({ name, type }) => name + ' ' + type).join(', ')}</p>)}
        {physical.schema.tables.length === 0 && <p>There are no supported tables in this namespace.</p>}
      </details>
      <details className="schema-difference"><summary>Applied migration ledger</summary>
        {physical.applied.map(({ name, sha256 }) => <p key={name}><code>{name}</code> <bdi title={sha256}>{sha256}</bdi></p>)}
        {physical.applied.length === 0 && <p>There are no recorded migrations in this ledger.</p>}
      </details>
    </section> : <p className="schema-empty">Inspect a target to compare its physical schema and ledger with this workspace.</p>}
    {applyReview && current && <Dialog title="Review Development Apply" className="schema-dialog" onClose={() => { if (!busy) { setApplyReview(false); setPassword(''); } }}>
      <div className="schema-form">
        <p>Target <bdi>{physical?.target}</bdi>. These statements may hold locks. Apply requires a dedicated local development database and a separate native confirmation.</p>
        <label>Pending migration<select value={shown?.name ?? ''} onChange={(event) => setDatabaseSelection(event.target.value)}>
          {pending.map(({ name }) => <option key={name}>{name}</option>)}
        </select></label>
        {shown && <><small className="schema-message-digest">SHA-256 {shown.sha256}</small><pre tabIndex={0}>{shown.sql}</pre></>}
        {error && <p role="alert" className="schema-error">{error}</p>}
        <label>Connection password<Input data-dialog-focus type="password" autoComplete="new-password" value={password}
          onChange={(event) => setPassword(event.target.value)} maxLength={1024} /></label>
        <div className="dialog-actions"><Button disabled={busy} onClick={() => { setApplyReview(false); setPassword(''); }}>Close</Button>
          <Button variant="primary" disabled={!valid || busy} onClick={() => request(true)}>Apply Development Migrations</Button></div>
      </div>
    </Dialog>}
  </div>;
}

export function DatabasePanel({ project, sourceSignal, initialTable }: { project: OpenProject; sourceSignal: string; initialTable?: string | undefined }) {
  const bridge = schemaBridge;
  const [view, setView] = useState<View>('schema');
  const [snapshot, setSnapshot] = useState<SchemaSnapshot>();
  const [draft, setDraft] = useState<{ value: DatabaseSchema; revision: string }>();
  const [points, setPoints] = useState<SchemaPoint[]>();
  const [selected, select] = useState(initialTable ?? '');
  const [migration, setMigration] = useState('');
  const [preview, setPreview] = useState<MigrationPreview>();
  const [physical, setPhysical] = useState<SchemaPhysical>();
  const [importing, setImporting] = useState(false);
  const [sql, setSql] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState('');
  const stale = Boolean(snapshot && draft && snapshot.revision !== draft.revision);

  useEffect(() => {
    let active = true;
    if (!bridge || project.availability !== 'ready') return;
    const load = (initial: boolean) => {
      void bridge.inspect(project.id).then((result) => {
        if (!active) return;
        if (result.ok) setSnapshot(result.value);
        else if (initial && result.error !== 'PROJECT_BUSY') setError(errors[result.error] ?? 'Source schema is unavailable.');
      }).catch(() => { if (active && initial) setError('Could not reach Database Studio.'); });
    };
    load(true);
    const timer = window.setInterval(() => load(false), 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [bridge, project.availability, project.id, sourceSignal]);

  const run = useCallback<Run>(async (description, call, accept) => {
    setBusy(description); setError(''); setStatus('');
    try {
      const result = await call();
      if (result.ok) accept(result.value);
      else setError(errors[result.error] ?? 'Database Studio could not complete this request.');
    } catch { setError('Could not reach the desktop database service.'); }
    finally { setBusy(''); }
  }, []);

  function refresh() {
    if (bridge) void run('Refreshing source schema…', () => bridge.inspect(project.id), (value) => {
      setSnapshot(value); setStatus('Source schema refreshed.');
    });
  }

  if (!bridge || project.availability !== 'ready') return <section className="schema-panel">
    <h2>Database Studio</h2><p role="status">The project folder must be available in the desktop workspace.</p>
  </section>;

  const workspace = snapshot ? { projectId: project.id, revision: snapshot.revision } : undefined;
  const model = draft?.value ?? snapshot?.schema;
  const layout = points ?? snapshot?.layout ?? [];
  const shown = snapshot?.migrations.find(({ name }) => name === migration) ?? snapshot?.migrations.at(-1);
  const review = preview?.migration;
  const reviewId = preview?.id ?? snapshot?.recovery?.id;
  const upToDate = physical && physical.revision === snapshot?.revision;
  const update = (value: DatabaseSchema) => {
    if (snapshot) setDraft({ value, revision: snapshot.revision });
  };

  return <section className="schema-panel" aria-label="Database Studio">
    <header className="schema-header">
      <div className="schema-title"><Database aria-hidden="true" size={22} /><div>
        <h2>Database Studio</h2><p>PostgreSQL <span>·</span> <bdi>{project.name}</bdi></p>
      </div></div>
      <Button className="outlined-button" disabled={Boolean(busy)} onClick={refresh}><RefreshCw size={14} />Refresh Source</Button>
    </header>
    <nav className="schema-nav" aria-label="Database Studio views">
      {views.map(({ id, label, icon: Icon }) => <Button key={id} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
        <Icon size={15} aria-hidden="true" />{label}
      </Button>)}
    </nav>
    {busy && <p className="schema-message" role="status">{busy}</p>}
    {error && <p className="schema-message schema-error" role="alert">{error}</p>}
    {status && <p className="schema-message schema-success" role="status">{status}</p>}
    {!snapshot && !error && !busy && <p role="status" className="schema-empty">Reading declared PostgreSQL migrations…</p>}
    {snapshot && model && workspace && <>
      {snapshot.diagnostics.length > 0 && <Diagnostics items={snapshot.diagnostics} />}
      {stale && <div className="schema-message schema-warning" role="alert">
        The source has changed since this draft began. Discard the draft to work from the current source.
      </div>}
      {snapshot.recovery && <section className="schema-recovery" aria-label="Migration recovery">
        <p>Publication of <code>{snapshot.recovery.migration.name}</code> needs recovery.</p>
        <Button className="outlined-button" disabled={Boolean(busy)} onClick={() => setPreview({
          id: snapshot.recovery!.id, migration: snapshot.recovery!.migration, diagnostics: [],
        })}>Review Recovery</Button>
      </section>}
      {view === 'schema' && <>
        <div className="schema-strip">
          <div><strong>{draft ? 'Schema draft' : 'Declared source schema'}</strong><small>{snapshot.migrations.length} migration files</small></div>
          <div className="schema-tool-actions">
            {draft && <Button onClick={() => { setDraft(undefined); setStatus('Draft discarded.'); }}>Discard Draft</Button>}
            <Button className="outlined-button" disabled={Boolean(busy) || stale || snapshot.diagnostics.length > 0}
              onClick={() => { setSql(''); setImporting(true); }}><FileCode size={14} />Import SQL</Button>
            <Button variant="primary" disabled={Boolean(busy || !draft || stale || snapshot.recovery) || snapshot.diagnostics.length > 0}
              onClick={() => void run('Planning the source migration…', () => bridge.preview({ ...workspace, schema: model }), (result) => {
                if (result.migration || result.diagnostics.length) setPreview(result);
                else setStatus('The draft matches the declared source schema.');
              })}>Preview Migration</Button>
          </div>
        </div>
        <SchemaDesigner schema={model} selected={selected} select={select} onChange={update} readOnly={stale || snapshot.diagnostics.length > 0} />
        {draft && <DraftDiagnostics schema={model} />}
      </>}
      {view === 'diagram' && <Diagram schema={model} selected={selected} select={select} layout={layout} onLayout={setPoints} busy={Boolean(busy)}
        save={() => void run('Saving diagram layout…', () => bridge.layout({ ...workspace, points: layout }),
          (value) => { setPoints(undefined); setSnapshot((current) => current && { ...current, layout: value }); setStatus('Diagram layout saved.'); })} />}
      {view === 'migrations' && <div className="schema-migrations">
        <aside aria-label="Migration files">
          <header><h3>Source sequence</h3><small>{upToDate ? physical.target : 'Inspect a target to read applied status'}</small></header>
          <ul>{snapshot.migrations.map((item) => <li key={item.name}><Button aria-pressed={shown?.name === item.name} onClick={() => setMigration(item.name)}>
            <FileCode size={15} /><bdi>{item.name}</bdi>
            <small>{migrationStatus(item, upToDate ? physical : undefined)}</small>
          </Button></li>)}</ul>
        </aside>
        {shown && <section aria-label="Migration SQL">
          <header><h3>{shown.name}</h3><small className="schema-message-digest">SHA-256 {shown.sha256}</small></header>
          <pre tabIndex={0}>{shown.sql}</pre>
        </section>}
      </div>}
      {view === 'physical' && <Connection snapshot={snapshot} project={project} physical={physical} busy={Boolean(busy)} error={error} run={run}
        onResult={(value) => { if (value) setPhysical(value); }} />}
      {importing && <Dialog title="Review SQL Import" className="schema-dialog" onClose={() => { if (!busy) setImporting(false); }}>
        <div className="schema-form">
          <p>Paste PostgreSQL table, column, constraint or index DDL. Studio parses the text and puts supported changes in the draft.</p>
          <label>PostgreSQL DDL<textarea value={sql} rows={10} maxLength={SCHEMA_LIMITS.sql} data-dialog-focus
            onChange={(event) => setSql(event.target.value)} /></label>
          <div className="dialog-actions"><Button disabled={Boolean(busy)} onClick={() => setImporting(false)}>Cancel</Button>
            <Button variant="primary" disabled={!sql.trim() || Boolean(busy) || stale} onClick={() =>
              void run('Parsing SQL locally…', () => bridge.parse({ sql, schema: model }), (result) => {
                setImporting(false);
                if (result.diagnostics.length) setPreview({ id: project.id, migration: null, diagnostics: result.diagnostics });
                else { update(result.schema); setStatus('SQL imported into the draft.'); }
              })}>Parse SQL</Button></div>
        </div>
      </Dialog>}
      {preview && <Dialog title={snapshot.recovery ? 'Migration Recovery' : 'Migration Review'} className="schema-dialog" onClose={() => { if (!busy) setPreview(undefined); }}>
        <div className="schema-form">
          <Diagnostics items={preview.diagnostics} />
          {review && <><p>Add a source migration in <code>db/migrations/{review.name}</code>. Database apply is a separate action.</p>
            <small className="schema-message-digest">SHA-256 {review.sha256}</small><pre tabIndex={0}>{review.sql}</pre></>}
          {error && <p role="alert" className="schema-error">{error}</p>}
          {busy && <p role="status">{busy}</p>}
          <div className="dialog-actions">
            <Button disabled={Boolean(busy)} onClick={() => setPreview(undefined)}>Close</Button>
            {snapshot.recovery && <Button disabled={Boolean(busy)} onClick={() => void run('Waiting for recovery confirmation…',
              () => bridge.release({ ...workspace, id: snapshot.recovery!.id }), (value) => {
                if (value) { setSnapshot(value); setPreview(undefined); setStatus('Migration recovery handed off.'); }
              })}>Hand Off Recovery</Button>}
            {review && reviewId && <Button variant="primary" disabled={Boolean(busy || stale)} onClick={() => {
              void run('Waiting for confirmation…', () => bridge.publish({ ...workspace, id: reviewId }), (value) => {
                if (value) { setSnapshot(value); setDraft(undefined); setPreview(undefined); setStatus('Migration published and verified.'); }
              });
            }}>{snapshot.recovery ? 'Resume Publication' : 'Publish Migration'}</Button>}
          </div>
        </div>
      </Dialog>}
    </>}
  </section>;
}
