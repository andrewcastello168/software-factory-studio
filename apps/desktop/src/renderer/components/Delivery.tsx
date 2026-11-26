import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileCheck2, RefreshCw } from 'lucide-react';
import { GO_STACK, STACKS, isPackageRequest, isProjectId, qualityTasks, requiredQuality } from '@factory/contracts';
import type {
  AssetPin, DeliveryInspection, DeliveryOption, DeveloperBridge, ErrorCode, IncrementalInspection, IncrementalPreview,
  LibraryAsset, OpenProject, QualityTask, Result, RuntimeInspection, RuntimePreview, SharedLibrary,
} from '@factory/contracts';
import { browserPreview } from '../usePreferences';
import { Button } from './Controls';
import { developerBridge, developerErrors, taskLabels } from './Developer';
import { libraryBridge } from './EngineeringLibrary';
import { ChangePreview, incrementalBridge } from './GenerationReview';

export const deliveryBridge = browserPreview ? undefined : window.studio?.delivery;
const views = ['Project Inspector', 'Quality Center', 'Shared Library', 'Deployment', 'Release Center', 'Project History'] as const;
type View = typeof views[number];
type Logs = Extract<Awaited<ReturnType<DeveloperBridge['logs']>>, { ok: true }>['value'];
type Run = <T>(label: string, action: () => Promise<Result<T>>, done?: (value: T) => void, blocked?: (error: ErrorCode) => void) => Promise<void>;
const errors: Partial<Record<ErrorCode, string>> = {
  ...developerErrors,
  DELIVERY_BLOCKED: 'This action needs a supported worktree, available prerequisites, or current verification. Review the details below.',
  DELIVERY_STALE: 'The worktree, configuration, or build output changed. Inspect again and rerun affected checks.',
  DELIVERY_CONFLICT: 'The existing file, history, or permissions blocked the operation. Review the worktree and choose a vacant destination.',
  LIBRARY_CONFLICT: 'A local asset has the same version with different content, or library storage could not be updated.',
};
const formatTime = (value: string) => new Date(value).toLocaleString();
const supported = (stack: DeliveryInspection['stack'], task: QualityTask) => Boolean(stack)
  && (stack === GO_STACK ? task !== 'postgres' : !['format', 'vet', 'vulnerability'].includes(task));
const slug = (asset: Pick<LibraryAsset, 'id' | 'version'>) => asset.id + ':' + asset.version;

function Inspector({ inspection, generated, runtime, openSource }: {
  inspection: DeliveryInspection; generated: IncrementalInspection | undefined; runtime: RuntimeInspection | undefined; openSource(path: string): void;
}) {
  const stack = inspection.stack && STACKS[inspection.stack];
  const supportedStack = Boolean(stack);
  const changed = generated?.files.filter(({ owner, state }) => owner && state !== 'generated') ?? [];
  return <div className="dev-grid">
    <section className="project-section">
      <h2>Source and standards</h2>
      <dl className="dev-facts">
        <div><dt>Project</dt><dd title={inspection.project ?? undefined}>{inspection.name}</dd></div>
        <div><dt>Worktree</dt><dd title={inspection.worktree}><code>{inspection.worktree.slice(0, 24)}</code></dd></div>
        <div><dt>Source revision</dt><dd><code>{inspection.head?.slice(0, 12) ?? 'Uncommitted project'}</code></dd></div>
        <div><dt>Git state</dt><dd>{inspection.branch ?? 'No named branch'} · {inspection.clean ? 'Clean' : 'Requires review'}</dd></div>
        <div><dt>Stack and architecture</dt><dd>{generated?.profile?.stack ?? (stack ? stack.label : 'Unsupported')} · {generated?.profile?.architecture ?? (stack ? stack.architectureLabel : 'Unknown')}</dd></div>
        <div><dt>Engineering profile</dt><dd>{generated?.profile?.engineering ?? (stack && !generated ? 'Reading profile…' : 'Unavailable')}</dd></div>
        <div><dt>Interface template</dt><dd>{inspection.template ?? 'Standard layout'}</dd></div>
        <div><dt>Installed modules</dt><dd>{generated?.profile?.modules.join(', ') || 'None recorded'}</dd></div>
      </dl>
      <p>Version locks and owned fingerprints are enforced by the generator. Natural-language profile guidance is advisory.</p>
      <div className="dev-actions">
        {['AGENTS.md', 'docs/CODING_STANDARDS.md', 'docs/ENGINEERING_PROFILE.md'].filter((path) => generated?.files.some((file) => file.path === path))
          .map((path) => <Button key={path} className="outlined-button" onClick={() => openSource(path)}>{path}</Button>)}
      </div>
      <dl className="dev-facts">{inspection.locks.map(({ name, digest }) => <div key={name}>
        <dt><Button onClick={() => openSource(name)}>{name}</Button></dt><dd>{digest ? <code title={digest}>{digest.slice(0, 12)}</code> : 'Error · unreadable'}</dd></div>)}</dl>
    </section>
    <section className="project-section">
      <h2>Findings</h2>
      <ul className="dev-artifact-list">
        <li><div><strong>{supportedStack ? 'Verified' : 'Unsupported'}</strong><span>{supportedStack ? 'Pinned stack and engine locks are recognized.' : 'Open a supported generated project to verify its locks.'}</span></div></li>
        <li><div><strong>{inspection.source ? 'Verified' : 'Blocked'}</strong><span>{inspection.source ? 'The source fingerprint is current.' : 'Review workspace links, permissions, and inventory limits.'}</span></div></li>
        {runtime?.tools.filter(({ required, name }) => required && name !== 'Git').map(({ name, version, required }) =>
          <li key={name}><div><strong>{version === required ? 'Verified' : 'Warning'} · {name}</strong><span>{version ?? 'Unavailable'} · expected {required}</span></div></li>)}
        {inspection.environment.map((name) => <li key={name}><div><strong>Information · {name}</strong><span>Not configured in local .env.</span></div></li>)}
        {generated?.issues.map((issue, index) => <li key={index}><div><strong>Warning · generation or migration inspection</strong><span>{issue}</span></div></li>)}
        {generated && !generated.issues.length && supportedStack && <li><div><strong>Verified · source migrations</strong>
          <span>{generated.sources.length} readable source migration(s). Use Database Studio for physical database checks.</span></div></li>}
      </ul>
      <h3>Owned files and documentation</h3>
      {changed.length ? <ul className="dev-artifact-list">{changed.map(({ path, state }) =>
        <li key={path}><div><span>{path}</span><small>{state === 'missing' || state === 'protected' ? 'Error' : 'Warning'} · {state}</small></div>
          {!path.startsWith('.factory/') && state === 'modified' && <Button className="outlined-button" onClick={() => openSource(path)}>Open Source</Button>}</li>)}</ul>
        : <p className="structure-note">{supportedStack && generated?.profile ? 'No missing or modified owned files were found.' : supportedStack && !generated ? 'Reading ownership evidence…' : 'Ownership evidence is unavailable.'}</p>}
    </section>
  </div>;
}

function Shared({ projectId, run, busy, openGit }: { projectId: string; run: Run; busy: boolean; openGit(): void }) {
  const bridge = deliveryBridge;
  const [shares, setShares] = useState<SharedLibrary>();
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [selected, setSelected] = useState<AssetPin[]>([]);
  const [notice, setNotice] = useState('');
  const refresh = () => {
    const library = libraryBridge;
    if (bridge && library) void run('Reading shared library…', async () => {
      const portable = await bridge.shares(projectId);
      const local = await library.list();
      return portable.ok && local.ok ? { ok: true, value: { portable: portable.value, local: local.value } }
        : portable.ok ? { ok: false, error: 'LIBRARY_CONFLICT' } : portable;
    }, ({ portable, local }) => { setShares(portable); setAssets(local.filter(({ id }) => isProjectId(id))); });
  };
  const exportBundle = () => {
    if (bridge) void run('Reviewing export…', () => bridge.export({ projectId, assets: selected }), (bundle) => {
      if (!bundle) return;
      setNotice('Exported bundle ' + bundle.digest.slice(0, 12) + '. Review and commit it in Git Studio.');
      setShares((before) => before && { ...before, entries: [bundle, ...before.entries.filter(({ digest }) => digest !== bundle.digest)] });
    });
  };
  return <div className="dev-grid">
    <section className="project-section">
      <h2>Shared Engineering Library</h2>
      <p>Open the Git worktree used for team assets. Bundles are data-only, content-addressed files under <code>factory-library/</code>.</p>
      <div className="dev-actions"><Button className="outlined-button" disabled={busy} onClick={refresh}>Read Repository Bundles</Button>
        <Button className="outlined-button" onClick={openGit}>Open Git Studio</Button></div>
      {shares && !shares.entries.length && <p>No valid bundles were found.</p>}
      {Boolean(shares?.rejected) && <p role="status">{shares?.rejected} invalid or unsupported entries were excluded.</p>}
      <ul className="dev-artifact-list">{shares?.entries.map(({ digest, assets: entries }) => <li key={digest}>
        <div><span title={digest}>{digest.slice(0, 12)}</span>{entries.map((asset) => <small key={slug(asset)}>{asset.name} v{asset.version}</small>)}</div>
        <Button className="outlined-button" disabled={busy} onClick={() => bridge && void run('Reviewing import…',
          () => bridge.import({ projectId, digest }), (count) => { if (count !== null) setNotice(count + ' exact versions added to your library.'); })}>Import Exact Versions</Button>
      </li>)}</ul>
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="project-section">
      <h2>Export local versions</h2>
      <p>Share personal profiles and template versions. Built-in architectures, modules, CI and deployment capabilities are pinned as references.</p>
      {assets.map((asset) => <label key={slug(asset)} className="delivery-check"><input type="checkbox" checked={selected.some((entry) => slug(entry) === slug(asset))}
        disabled={busy || (selected.length >= 8 && !selected.some((entry) => slug(entry) === slug(asset)))}
        onChange={(event) => setSelected(event.target.checked ? [...selected, { id: asset.id, version: asset.version }] : selected.filter((entry) => slug(entry) !== slug(asset)))}/>
        {asset.name} · v{asset.version} · {asset.kind}</label>)}
      <Button className="outlined-button" disabled={!selected.length || busy} onClick={exportBundle}>Review Export</Button>
    </section>
  </div>;
}

export function DeliveryWorkspace({ project, signal, openSource, openRecovery }: {
  project: OpenProject; signal: string; openSource(path: string): void; openRecovery(view: 'git' | 'database' | 'generation'): void;
}) {
  const bridge = deliveryBridge;
  const [view, setView] = useState<View>('Project Inspector');
  const [inspection, setInspection] = useState<DeliveryInspection>();
  const [generated, setGenerated] = useState<IncrementalInspection>();
  const [runtime, setRuntime] = useState<RuntimeInspection>();
  const [logs, setLogs] = useState<Logs>([]);
  const [blocked, setBlocked] = useState<QualityTask[]>([]);
  const [command, setCommand] = useState<{ task: QualityTask; value: RuntimePreview }>();
  const [currentTask, setCurrentTask] = useState<QualityTask>('lint');
  const [activeId, setActiveId] = useState<string>();
  const [plan, setPlan] = useState<IncrementalPreview>();
  const [file, setFile] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [notes, setNotes] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const lock = useRef(false);
  const observation = useRef<Promise<void> | undefined>(undefined);
  const id = project.id;
  const refresh = useCallback(async (force = false) => {
    if (!bridge || (lock.current && !force)) return;
    if (observation.current) return observation.current;
    const task = (async () => {
      const outcome = await bridge.inspect(id);
      if (outcome.ok) setInspection(outcome.value);
      else if (outcome.error !== 'PROJECT_BUSY') setError(errors[outcome.error] ?? 'Inspection failed.');
      const result = await incrementalBridge?.inspect(id);
      if (result?.ok) setGenerated(result.value);
    })();
    observation.current = task;
    try { await task; }
    finally { if (observation.current === task) observation.current = undefined; }
  }, [bridge, id]);
  useEffect(() => {
    if (project.availability !== 'ready') return;
    void refresh();
    void developerBridge?.inspect(id).then((result) => { if (result.ok) setRuntime(result.value); });
  }, [id, project.availability, refresh, signal]);
  useEffect(() => {
    const runner = developerBridge;
    if (!runner || view !== 'Quality Center') return;
    let live = true;
    const timer = window.setInterval(() => {
      void runner.logs(id).then((result) => {
        if (!live || !result.ok) return;
        setLogs(result.value);
        const finished = result.value.find(({ process }) => process.id === activeId
          && !['starting', 'running', 'stopping'].includes(process.state));
        if (finished) {
          setActiveId(undefined);
          void refresh();
        }
      });
    }, 850);
    return () => { live = false; window.clearInterval(timer); };
  }, [activeId, id, refresh, view]);

  const run: Run = async (label, action, done, onBlocked) => {
    if (lock.current) return;
    lock.current = true; setBusy(label); setError(''); setNotice('');
    try {
      await observation.current;
      const result = await action();
      if (result.ok) done?.(result.value);
      else { setError(errors[result.error] ?? 'Studio could not complete this action.'); onBlocked?.(result.error); }
    } catch { setError('Studio could not reach the desktop service.'); }
    finally { lock.current = false; setBusy(''); }
  };
  if (!bridge || project.availability !== 'ready') return <main className="page"><p className="notice">Open an available worktree.</p></main>;

  const previewDelivery = (option: DeliveryOption) => {
    const generator = incrementalBridge;
    if (!generator) return;
    setPlan(undefined);
    void run('Planning deployment files…', async () => {
      const current = await generator.inspect(id);
      return current.ok ? generator.preview({ projectId: id, revision: current.value.revision, backend: [], frontend: [], delivery: option }) : current;
    }, (preview) => { setPlan(preview); setFile(preview.changes[0]?.path ?? ''); });
  };
  const previewQuality = (task: QualityTask) => {
    const runner = developerBridge;
    if (!runner) return;
    setCurrentTask(task); setCommand(undefined);
    void run('Reviewing quality command…', () => runner.preview({ projectId: id, frontendPort: 5173, task, quality: true }),
      (value) => { setCommand({ task, value }); setBlocked((items) => items.filter((item) => item !== task)); },
      () => setBlocked((items) => [...new Set([...items, task])]));
  };
  const currentStatus = (task: QualityTask) => {
    if (!inspection || !supported(inspection.stack, task)) return 'Skipped · unsupported';
    const observed = logs.find(({ process }) => process.task === task && process.id === activeId)?.process;
    if (observed && ['running', 'starting', 'stopping'].includes(observed.state)) return observed.state;
    if (blocked.includes(task)) return 'Blocked';
    const evidence = inspection.quality.find((entry) => entry.task === task);
    return evidence ? evidence.source === inspection.source ? evidence.outcome : 'Stale' : 'Pending';
  };
  const selectedLog = logs.find(({ process }) => process.task === currentTask);
  const selectedFile = plan?.changes.find(({ path }) => path === file);
  const failedSecurityCheck = ['audit', 'vulnerability', 'postgres'].some((task) => inspection?.quality
    .find((row) => row.task === task && row.source === inspection.source)?.outcome === 'failed');
  const releaseReady = Boolean(!failedSecurityCheck && inspection?.clean && inspection.stack && inspection.source
    && requiredQuality(inspection.stack).every((task) => {
      const record = inspection.quality.find((item) => item.task === task && item.source === inspection.source);
      return record?.outcome === 'passed' && (task !== 'build' || Boolean(record.output));
    }));

  return <div className="page developer-page delivery-page">
    <header className="page-header"><div><h1>Client Delivery</h1><p className="project-path"><bdi>{project.directory}</bdi></p></div>
      <Button className="outlined-button" disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={15}/>Refresh Evidence</Button></header>
    <nav className="dev-tabbar" aria-label="Delivery views">{views.map((item) => <Button key={item} aria-current={view === item ? 'page' : undefined}
      onClick={() => setView(item)}>{item}</Button>)}</nav>
    {error && <p className="notice" role="alert">{error}</p>}
    {(busy || notice) && <p className="dev-status" role="status">{busy || notice}</p>}
    {view === 'Project Inspector' && (inspection ? <Inspector inspection={inspection} generated={generated} runtime={runtime} openSource={openSource} />
      : <p role="status">Inspecting the worktree…</p>)}
    {view === 'Shared Library' && <Shared key={id} projectId={id} run={run} busy={Boolean(busy)} openGit={() => openRecovery('git')} />}
    {view === 'Quality Center' && <div className="dev-grid">
      <section className="project-section">
        <h2>Quality Center</h2>
        <p>Review and run each check against this worktree. Only evidence from the current source and configuration can qualify a release.</p>
        <ul className="dev-artifact-list">{qualityTasks.map((task) => <li key={task}>
          <div><Button onClick={() => setCurrentTask(task)}>{taskLabels[task]}</Button><small>{currentStatus(task)}</small></div>
          <Button className="outlined-button" disabled={Boolean(busy || activeId) || !inspection?.source || !supported(inspection.stack, task)}
            onClick={() => previewQuality(task)}>Review {taskLabels[task]}</Button>
        </li>)}</ul>
      </section>
      <section className="project-section">
        <h2>Command and logs</h2>
        {command && <div className="dev-review">
          <h3>{taskLabels[command.task]}</h3><p>{command.value.cwd}</p>
          <pre tabIndex={0}>{command.value.steps.map(({ executable, args }) => JSON.stringify([executable, ...args])).join('\n')}</pre>
          <Button className="primary-button" disabled={Boolean(busy || activeId)} onClick={() => {
            const runner = developerBridge;
            setCommand(undefined);
            if (runner) void run('Waiting for native approval…', () => runner.start({ projectId: id, id: command.value.id }),
              (value) => { setActiveId(value.id); setCurrentTask(command.task); }, () => setBlocked((items) => [...new Set([...items, command.task])]));
          }}>Approve and Run Check</Button>
        </div>}
        {selectedLog && <><p>{selectedLog.process.state} · started {formatTime(selectedLog.process.started)} · exit {selectedLog.process.code ?? '—'}</p>
          {selectedLog.process.id === activeId && <Button className="outlined-button" disabled={Boolean(busy)} onClick={() => {
            const runner = developerBridge;
            if (runner) void run('Stopping check…', () => runner.control({ projectId: id, id: selectedLog.process.id, action: 'stop' }));
          }}>Stop Check</Button>}
          <pre className="dev-output" tabIndex={0}>{selectedLog.lines.map(({ at, stream, text }) => at.slice(11, 23) + ' ' + stream + ' ' + text).join('\n') || 'No process output.'}</pre>
        </>}
        {inspection?.quality.filter(({ task }) => task === currentTask).slice(0, 3).map((entry) =>
          <p key={entry.id}>{entry.outcome} · {entry.source === inspection.source ? 'current' : 'stale'} · {formatTime(entry.started)}
            {' · ' + Math.max(0, Date.parse(entry.ended) - Date.parse(entry.started)) + ' ms · exit ' + (entry.code ?? '—')}</p>)}
        {!selectedLog && !command && <p className="structure-note">Select or review a check to inspect its output.</p>}
      </section>
    </div>}
    {view === 'Deployment' && <section className="project-section">
      <h2>Deployment Configuration</h2>
      <p>Review the stack-compatible GitHub verification workflow or Docker configuration. The deployment guide covers development, staging, and production configuration.</p>
      <div className="dev-actions">
        <Button className="outlined-button" disabled={Boolean(busy) || !inspection?.stack} onClick={() => previewDelivery('ci')}>Review CI Template</Button>
        <Button className="outlined-button" disabled={Boolean(busy) || !inspection?.stack} onClick={() => previewDelivery('docker')}>Review Docker Template</Button>
      </div>
      {plan && <>
        {plan.issues.length > 0 && <ul className="notice" role="alert">{plan.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
        <div className="dev-actions">{plan.changes.map(({ path }) => <Button key={path} className="outlined-button" aria-pressed={file === path}
          onClick={() => setFile(path)}>{path}</Button>)}</div>
        {selectedFile && <article className="incremental-preview"><ChangePreview change={selectedFile} /></article>}
        {!plan.changes.length && !plan.issues.length && <p>The reviewed template is already installed.</p>}
        <Button className="primary-button" disabled={Boolean(busy) || !plan.changes.length || Boolean(plan.issues.length)} onClick={() => {
          const generator = incrementalBridge;
          if (generator) void run('Waiting for native approval…', () => generator.apply({ projectId: id, id: plan.id }),
            (result) => { if (result) { setPlan(undefined); setNotice('Reviewed delivery files written.'); void refresh(true); } });
        }}>Approve and Apply</Button>
      </>}
    </section>}
    {view === 'Release Center' && <section className="project-section">
      <h2>Release Center</h2>
      <p>{releaseReady ? 'The clean revision has current required quality evidence.' : 'Commit the worktree and pass the required Quality Center checks on that revision before packaging.'}</p>
      {failedSecurityCheck && <p role="alert">A current advisory or integration check failed. Review and rerun it before packaging.</p>}
      <p>Use Build in Quality Center for a development build. A verified release adds a reviewed archive and SHA-256 to project history.</p>
      <div className="dev-row">
        <label>Release version <input value={version} onChange={(event) => setVersion(event.target.value)} /></label>
      </div>
      <label>Release notes <textarea value={notes} maxLength={1600} onChange={(event) => setNotes(event.target.value)} /></label>
      <div className="dev-actions">
        <Button className="primary-button" disabled={Boolean(busy) || !releaseReady} onClick={() => {
          const input = { projectId: id, version, notes, source: inspection?.source };
          if (!isPackageRequest(input)) { setError('Enter a valid version and keep credentials out of release notes.'); return; }
          void run('Reviewing package…', () => bridge.package(input), (result) => {
            if (result) { setNotice('Release verified · ' + result.sha256.slice(0, 12)); void refresh(true); }
          });
        }}><Download size={14}/>Review Release Archive</Button>
      </div>
      <ReleaseList inspection={inspection} />
    </section>}
    {view === 'Project History' && <div className="dev-grid">
      <section className="project-section">
        <h2>Project History</h2>
        <h3>Generation and schema sources</h3>
        <ul className="dev-artifact-list">{generated?.history.map(({ id: operation, outcome, at, files }) =>
          <li key={operation}>{formatTime(at)} · {outcome} · {files} files</li>)}</ul>
        {generated?.sources.length ? <ul className="dev-artifact-list">{generated.sources.map(({ name, sha256 }) =>
          <li key={name}>{name} · <code>{sha256.slice(0, 12)}</code></li>)}</ul> : <p>No source migration evidence.</p>}
        <div className="dev-actions">
          <Button className="outlined-button" onClick={() => openRecovery('generation')}>Filesystem Recovery</Button>
          <Button className="outlined-button" onClick={() => openRecovery('git')}>Git Recovery</Button>
          <Button className="outlined-button" onClick={() => openRecovery('database')}>Database Studio</Button>
        </div>
        <p>Source recovery does not revert an applied migration or deployed release.</p>
      </section>
      <section className="project-section">
        <h2>Checks and artifacts</h2>
        <ul className="dev-artifact-list">{inspection?.quality.map((row) => <li key={row.id}>{formatTime(row.started)} · {taskLabels[row.task]}
          {' · ' + row.outcome + (row.source === inspection.source ? '' : ' · stale')}</li>)}</ul>
        <ReleaseList inspection={inspection} />
      </section>
    </div>}
  </div>;
}

function ReleaseList({ inspection }: { inspection?: DeliveryInspection | undefined }) {
  return <ul className="dev-artifact-list">
    {inspection?.releases.map(({ release, artifact }) => <li key={release.id}><FileCheck2 size={16} />
      <div><strong>{release.name} · {release.version} · {artifact}</strong><span>{release.file}</span>
        <small>Commit {release.head.slice(0, 12)} · {formatTime(release.created)} · {release.bytes.toLocaleString()} bytes</small>
        <code title={release.sha256}>{release.sha256}</code>{release.notes && <p>{release.notes}</p>}</div>
    </li>)}
  </ul>;
}
