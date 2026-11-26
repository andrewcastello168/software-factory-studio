import { GO_STACK, IDENTITY_MODULES, MODULE_CATALOG } from '@factory/contracts';
import type { ModuleSelection } from '@factory/contracts';
import { useEffect, useRef, useState } from 'react';
import { FileCode, FilePlus2, FileWarning, GitBranch, ListChecks, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ErrorCode, IncrementalChange, IncrementalInspection, IncrementalPreview, OpenProject, Result } from '@factory/contracts';
import { browserPreview } from '../usePreferences';
import { Button } from './Controls';

export const incrementalBridge = browserPreview ? undefined : window.studio?.incremental;

const failureMessages: Partial<Record<ErrorCode, string>> = {
  INCREMENTAL_STALE: 'The workspace, source migrations, files or Git state changed. Refresh and review a new plan.',
  INCREMENTAL_UNSUPPORTED: 'The project or its generator locks are outside the supported starter layout.',
  INCREMENTAL_CONFLICT: 'Studio could not verify this operation. Inspect the paths and ownership before retrying.',
  GENERATOR_RECOVERY: 'The generation journal needs recovery. Refresh to inspect it.',
  ACCESS_DENIED: 'Open the project again to authorize this operation.',
  PROJECT_BUSY: 'Another workspace operation is in progress.',
};
const labels = { create: 'Create', modify: 'Modify', unchanged: 'Unchanged', protected: 'Protected', conflict: 'Conflict' };
const reviewOrder = { modify: 0, create: 0, conflict: 0, protected: 1, unchanged: 2 };
const statuses = { generated: 'Generated', modified: 'Modified', missing: 'Missing', user: 'User-owned', discovered: 'Discovered', protected: 'Protected' };

export function ChangePreview({ change }: { change: IncrementalChange }) {
  const [full, setFull] = useState(false);
  const before = change.before?.split('\n') ?? [];
  const after = change.after?.split('\n') ?? [];
  let first = 0;
  while (first < before.length && first < after.length && before[first] === after[first]) first++;
  let last = 0;
  while (last < before.length - first && last < after.length - first
    && before[before.length - last - 1] === after[after.length - last - 1]) last++;
  const pane = (lines: string[], name: string, diff: 'before' | 'after') => {
    const start = full ? 0 : Math.max(0, first - 3);
    const end = full ? lines.length : Math.min(lines.length, lines.length - last + 3);
    return <section aria-label={name}>
      <h4>{name}</h4>
      <pre tabIndex={0}>
        {start > 0 && <span className="incremental-context">{'… ' + start + ' identical lines\n'}</span>}
        {lines.slice(start, end).map((line, offset) => {
          const index = offset + start;
          return <span key={index} data-change={index >= first && index < lines.length - last ? diff : undefined}>{line || ' '}{'\n'}</span>;
        })}
        {end < lines.length && <span className="incremental-context">{'… ' + (lines.length - end) + ' identical lines\n'}</span>}
      </pre>
    </section>;
  };
  return <>
    <header><bdi>{change.path}</bdi><strong data-action={change.action}>{labels[change.action]}</strong></header>
    <div className="incremental-diff-heading">
      <p>{change.reason}</p>
      {change.before !== null && (first > 3 || last > 3) && <Button onClick={() => setFull(!full)} aria-pressed={full}>
        {full ? 'Show changed lines' : 'Show full files'}
      </Button>}
    </div>
    {change.after !== null && <div className="incremental-diff" data-created={change.before === null}>
      {change.before !== null && pane(before, 'Before', 'before')}
      {pane(after, change.before === null ? 'New file' : 'After', 'after')}
    </div>}
  </>;
}

export function GenerationReview({ project, signal }: { project: OpenProject; signal: string }) {
  const bridge = incrementalBridge;
  const goProject = project.metadata.status === 'managed' && project.metadata.descriptor.stackId === GO_STACK;
  const [inspection, setInspection] = useState<IncrementalInspection>();
  const [backend, setBackend] = useState<string[]>([]);
  const [frontend, setFrontend] = useState<string[]>([]);
  const [modules, setModules] = useState<ModuleSelection[]>([]);
  const [review, setReview] = useState<{ value: IncrementalPreview; revision: string }>();
  const [selected, select] = useState('');
  const [section, setSection] = useState<'plan' | 'files' | 'history'>('plan');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const backgroundInspection = useRef<Promise<void> | null>(null);
  const foregroundAction = useRef(false);

  useEffect(() => {
    if (!bridge || project.availability !== 'ready') return;
    let live = true;
    const refresh = () => {
      if (backgroundInspection.current || foregroundAction.current) return;
      backgroundInspection.current = bridge.inspect(project.id).then((reply) => {
        if (!live) return;
        if (reply.ok) setInspection(reply.value);
        else if (reply.error !== 'PROJECT_BUSY') setError(failureMessages[reply.error] ?? 'Workspace inspection failed.');
      }).catch(() => {
        if (live) setError('Studio could not reach the desktop generation service.');
      }).finally(() => {
        backgroundInspection.current = null;
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 10_000);
    return () => { live = false; window.clearInterval(timer); };
  }, [bridge, project.id, project.availability, signal]);

  async function run<T>(label: string, action: () => Promise<Result<T>>, finish: (value: T) => void) {
    if (foregroundAction.current) return;
    foregroundAction.current = true;
    setBusy(label); setError(''); setStatus('');
    try {
      await backgroundInspection.current;
      const result = await action();
      if (result.ok) finish(result.value);
      else {
        setError(failureMessages[result.error] ?? 'Studio could not complete this operation.');
        if (result.error === 'GENERATOR_RECOVERY' && bridge) {
          const refreshed = await bridge.inspect(project.id);
          if (refreshed.ok) setInspection(refreshed.value);
        }
      }
    } catch { setError('Studio could not reach the desktop generation service.'); }
    finally { foregroundAction.current = false; setBusy(''); }
  }

  const recovery = inspection?.recovery;
  const preview = recovery ?? review?.value;
  const stale = Boolean(!recovery && review && inspection?.revision !== review.revision);
  const selectedChange = preview?.changes.find(({ path }) => path === selected)
    ?? preview?.changes.find(({ action }) => action === 'modify' || action === 'create') ?? preview?.changes[0];
  const writes = preview?.changes.filter(({ action }) => action === 'create' || action === 'modify').length ?? 0;
  const toggle = (rows: string[], name: string, checked: boolean) => checked ? [...rows, name] : rows.filter((item) => item !== name);
  const showResult = (value: IncrementalInspection | null) => {
    if (value) {
      setInspection(value); setReview(undefined); setBackend([]); setFrontend([]); setModules([]);
      setStatus(value.history[0]?.outcome === 'handed-off' ? 'Recovery handed off. Workspace files and backups were preserved.'
        : 'Generation result verified. See History for the receipt.');
    }
  };

  return <section className="schema-panel incremental-panel" aria-label="Generation Review">
    <header className="schema-header">
      <div className="schema-title"><ListChecks size={22} aria-hidden="true" /><div>
        <h2>Generation Review</h2><p><bdi>{project.name}</bdi> · {goProject ? 'Incremental CRUD' : 'Incremental CRUD and modules'}</p>
      </div></div>
      <Button className="outlined-button" disabled={!bridge || Boolean(busy)} onClick={() => bridge
        && void run('Inspecting checked-out sources…', () => bridge.inspect(project.id), setInspection)}><RefreshCw size={14} />Refresh</Button>
    </header>
    <nav className="schema-nav" aria-label="Generation Review views">
      {([['plan', 'Review plan'], ['files', 'Project files'], ['history', 'History']] as const).map(([id, title]) =>
        <Button key={id} aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{title}</Button>)}
    </nav>
    {busy && <p role="status" className="schema-message">{busy}</p>}
    {error && <p role="alert" className="schema-message schema-error">{error}</p>}
    {status && <p role="status" className="schema-message schema-success">{status}</p>}
    {!inspection && !error && <p role="status" className="schema-empty">{project.availability === 'ready' ? 'Inspecting project ownership…' : 'Open an available project folder.'}</p>}
    {inspection && <>
      <div className="incremental-profile">
        <span><GitBranch size={14} aria-hidden="true" />{inspection.branch ?? (inspection.head ? 'Detached HEAD' : 'No repository')}</span>
        {inspection.head && <code title={inspection.head}>{inspection.head.slice(0, 12)}</code>}
        {inspection.profile && <small>{inspection.profile.stack} · {inspection.profile.architecture} · {inspection.profile.engineering}
          {inspection.profile.modules.length > 0 && ' · ' + inspection.profile.modules.join(', ')}</small>}
      </div>
      {inspection.issues.length > 0 && <ul role="alert" className="schema-diagnostics">
        {inspection.issues.map((message, index) => <li key={index}>{message}</li>)}</ul>}
      {section === 'plan' && <>
        {recovery && <p className="schema-message schema-warning" role="status">This project has an interrupted generation. Review the saved files before resuming.
          {' '}Backup and staging files beside affected paths include operation ID <code>{recovery.id}</code>.</p>}
        {!recovery && inspection.profile && <div className="incremental-selection">
          <fieldset className="schema-layers">
            <legend>Selected CRUD layers</legend>
            <p className="schema-muted">API routes require appropriate deployment access controls.</p>
            {inspection.tables.map((table) => <div key={table.name} title={table.reason ?? undefined}>
              <code>{table.name}</code>
              <label><input type="checkbox" aria-label={'API for ' + table.name} checked={table.api || backend.includes(table.name)}
                disabled={table.api || Boolean(table.reason || busy)} onChange={(event) => {
                  const checked = event.target.checked;
                  setBackend(toggle(backend, table.name, checked));
                  if (!checked) setFrontend(toggle(frontend, table.name, false));
                  setReview(undefined);
                }} />API{table.api && ' · installed'}</label>
              <label><input type="checkbox" aria-label={'React page for ' + table.name} checked={table.page || frontend.includes(table.name)}
                disabled={table.page || Boolean(table.reason || busy || (!table.api && !backend.includes(table.name)))}
                onChange={(event) => { setFrontend(toggle(frontend, table.name, event.target.checked)); setReview(undefined); }} />
                React page{table.page && ' · installed'}</label>
              {table.reason && <small>{table.reason}</small>}
            </div>)}
            {!inspection.tables.length && <p className="schema-muted">No tables were found in supported source migrations.</p>}
          </fieldset>
          <Button variant="primary" disabled={!bridge || Boolean(busy) || inspection.issues.length > 0 || !inspection.tables.some((table) => table.api || backend.includes(table.name))}
            onClick={() => bridge && void run('Planning reviewed changes…', () => bridge.preview({
              projectId: project.id, revision: inspection.revision, backend, frontend,
            }), (value) => { setReview({ value, revision: inspection.revision }); select(''); })}>
            <FileCode size={14} />Preview Changes
          </Button>
        </div>}
        {!recovery && inspection.profile && !goProject && <details className="incremental-sources">
          <summary>Install optional modules</summary>
          <fieldset className="generator-modules">
            <legend>Choose exact releases and dependencies</legend>
            {IDENTITY_MODULES.map((pin) => {
              const item = MODULE_CATALOG.find(({ id }) => id === pin.id)!;
              const installed = inspection.profile?.modules.some((name) => name.startsWith(pin.id + ' ·'));
              return <label className="generator-module" key={pin.id}>
                <input type="checkbox" aria-label={'Install ' + item.label} checked={Boolean(installed || modules.some(({ id }) => id === pin.id))}
                  disabled={Boolean(installed || busy)} onChange={(event) => {
                    setModules(event.target.checked ? [...modules, pin] : modules.filter(({ id }) => id !== pin.id));
                    setReview(undefined);
                  }} />
                <span><strong>{item.label} · v{pin.version}</strong>
                  <small>{installed ? 'Installed' : item.requires.length ? 'Requires ' + item.requires.join(', ') : item.description}</small></span>
              </label>;
            })}
          </fieldset>
          <Button variant="primary" disabled={!bridge || !modules.length || Boolean(busy) || inspection.issues.length > 0}
            onClick={() => bridge && void run('Checking module compatibility…', () => bridge.preview({
              projectId: project.id, revision: inspection.revision, backend: [], frontend: [], modules,
            }), (value) => { setReview({ value, revision: inspection.revision }); select(''); })}>
            Preview Module Installation
          </Button>
        </details>}
        <details className="incremental-sources">
          <summary>Declared migration sources · {inspection.sources.length}</summary>
          <p>Existing SQL stays in place. Apply generation affects project files only and adds no dependencies.</p>
          <ul>{inspection.sources.map(({ name, sha256, external }) => <li key={name}><code>{name}</code> · {external ? 'External' : 'Generated'}
            {' '}<small title={sha256}>{sha256.slice(0, 12)}</small></li>)}</ul>
        </details>
        {preview && <section className="incremental-plan" aria-label="Planned changes">
          {preview.modules && <p className="schema-message">Version pins · {preview.modules.map(({ id, version }) => id + ' v' + version).join(', ')}</p>}
          <header><h3>Planned files</h3><small>{writes} writes · SHA-256 <code title={preview.digest}>{preview.digest.slice(0, 12)}</code></small></header>
          {stale && <p className="schema-message schema-warning" role="alert">The inspected sources changed. Preview the plan again.</p>}
          {preview.issues.length > 0 && <ul role="alert" className="schema-diagnostics">
            {preview.issues.map((message, index) => <li key={index}>{message}</li>)}</ul>}
          {selectedChange ? <div className="incremental-grid">
            <ul aria-label="Files in reviewed plan">{[...preview.changes].sort((a, b) => reviewOrder[a.action] - reviewOrder[b.action]).map((item) => <li key={item.path}>
              <Button title={item.path} onClick={() => select(item.path)} aria-pressed={item.path === selectedChange.path}>
                {item.action === 'conflict' || item.action === 'protected' ? <FileWarning size={14} /> : <FilePlus2 size={14} />}
                <bdi>{item.path}</bdi><small data-action={item.action}>{labels[item.action]}</small>
              </Button>
            </li>)}</ul>
            <div className="incremental-content"><ChangePreview key={selectedChange.path} change={selectedChange} /></div>
          </div> : <p className="schema-empty">No files require generation for this review.</p>}
          <div className="dialog-actions">
            {recovery && <Button disabled={!bridge || Boolean(busy)} onClick={() => bridge && void run('Waiting for recovery handoff…',
              () => bridge.handoff({ projectId: project.id, id: preview.id }), showResult)}>Hand Off Recovery</Button>}
            <Button variant="primary" disabled={!bridge || !writes || Boolean(stale || busy) || preview.issues.length > 0}
              onClick={() => bridge && void run('Waiting for approval and verifying generated files…',
                () => (recovery ? bridge.resume : bridge.apply)({ projectId: project.id, id: preview.id }), showResult)}>
              <ShieldCheck size={15} />{recovery ? 'Resume Generation' : 'Apply Generation'}
            </Button>
          </div>
        </section>}
      </>}
      {section === 'files' && <section className="incremental-list" aria-label="File ownership">
        <h3>File ownership</h3>
        <ul>{inspection.files.map(({ path, state, owner }) => <li key={path}><bdi>{path}</bdi><strong>{statuses[state]}</strong><small>{owner ?? '—'}</small></li>)}</ul>
      </section>}
      {section === 'history' && <section className="incremental-list" aria-label="Generation history">
        <h3>Generation history</h3>
        {inspection.history.length ? <ul>{inspection.history.map(({ id, at, digest, outcome, files }) => <li key={id}>
          <time dateTime={at}>{new Date(at).toLocaleString()}</time><strong>{outcome === 'applied' ? 'Applied' : 'Handed off'}</strong>
          <small>{files} files · <code title={digest}>{digest.slice(0, 12)}</code></small>
        </li>)}</ul> : <p className="schema-empty">No incremental generation recorded for this workspace.</p>}
      </section>}
    </>}
  </section>;
}
