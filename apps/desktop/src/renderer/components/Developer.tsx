import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Code2, FolderOpen, Play, RefreshCw, TerminalSquare } from 'lucide-react';
const runtimeTasks = ['backend', 'frontend', 'build', 'test'] as const;
import type { ArtifactLink, ErrorCode, Handoff, OpenProject, Result, RuntimeInspection, RuntimePreview, RuntimeTask, DeveloperBridge } from '@factory/contracts';
import { browserPreview } from '../usePreferences';
import { Button } from './Controls';
import { DesignWorkspace, Playground } from './DeveloperDesign';

export const developerBridge = browserPreview ? undefined : window.studio?.developer;
export const developerErrors: Partial<Record<ErrorCode, string>> = {
  ACCESS_DENIED: 'The operation was canceled or the workspace is no longer authorized.',
  DEVELOPER_UNSUPPORTED: 'Use a supported Studio-generated project with intact version locks and manifests.',
  DEVELOPER_STALE: 'The worktree, Git context or reviewed files changed. Inspect and review again.',
  DEVELOPER_TOOL: 'A required tool is missing or incompatible. Check Toolchains and install the required version independently.',
  DEVELOPER_EDITOR: 'VS Code was not found or could not be approved. Install it separately or use Choose VS Code to select its executable.',
  DEVELOPER_TERMINAL: 'No supported native terminal was found. Open your terminal separately at this worktree’s directory.',
  DEVELOPER_PATH: 'The selected item is unavailable or its path changed. Rescan the workspace and try again.',
  DEVELOPER_ENVIRONMENT: 'Review this worktree’s .env settings. Use an available local port and a loopback PostgreSQL development database.',
  DEVELOPER_PORT: 'The requested local port is in use or overlaps the backend. Choose a free port.',
  DEVELOPER_PROCESS: 'Studio could not complete the process action. Check the runtime logs.',
  DEVELOPER_NETWORK: 'The selected backend is unavailable or the request exceeded the local network limits.',
  INVALID_REQUEST: 'Correct the invalid fields and review the operation again.',
  PROJECT_BUSY: 'Wait for the current action or stop the running command.',
  INCREMENTAL_STALE: 'The checked-out artifacts changed. Refresh and review a new plan.',
  INCREMENTAL_UNSUPPORTED: 'Use a supported generated application with intact version locks.',
  INCREMENTAL_CONFLICT: 'The design, files or ownership could not be verified.',
  GENERATOR_RECOVERY: 'Open Generation Review to inspect the pending transaction.',
};

export const taskLabels: Record<RuntimeTask, string> = { backend: 'Backend', frontend: 'Frontend', build: 'Build', test: 'Tests',
  lint: 'Lint', typecheck: 'Type check', audit: 'Dependency audit', format: 'Go formatting', vet: 'Go vet',
  vulnerability: 'Go vulnerability analysis', postgres: 'PostgreSQL integration' };
type Logs = Extract<Awaited<ReturnType<DeveloperBridge['logs']>>, { ok: true }>['value'];
export type DeveloperSection = 'Runtime' | 'API Designer' | 'API Playground' | 'Page Designer' | 'Requirements';
type Run = <T>(label: string, operation: () => Promise<Result<T>>, done?: (value: T) => void) => Promise<void>;

export function DeveloperWorkspace({ project, signal, openTable }: { project: OpenProject; signal: string; openTable(table: string): void }) {
  const bridge = developerBridge;
  const [section, setSection] = useState<DeveloperSection>('Runtime');
  const [info, setInfo] = useState<RuntimeInspection>();
  const [logs, setLogs] = useState<Logs>([]);
  const [destination, setDestination] = useState<ArtifactLink>();
  const [task, setTask] = useState<RuntimeTask>('backend');
  const [frontendPort, setFrontendPort] = useState('5173');
  const [preview, setPreview] = useState<RuntimePreview>();
  const [logTask, setLogTask] = useState<RuntimeTask>('backend');
  const [filter, setFilter] = useState('');
  const [stream, setStream] = useState<'all' | 'stdout' | 'stderr' | 'studio'>('all');
  const [localPort, setLocalPort] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [target, setTarget] = useState('');
  const [line, setLine] = useState('');
  const [column, setColumn] = useState('');
  const [api, setApi] = useState<{ path: string; method: string; query: string[] }>();
  const running = useRef(false);
  const liveBackend = logs.find(({ process }) => process.task === 'backend' && process.ready && process.state === 'running')?.process;
  const selectedLogs = logs.find(({ process }) => process.task === logTask);
  const visible = selectedLogs?.lines.filter((row) => (stream === 'all' || row.stream === stream)
    && (!filter || row.text.toLowerCase().includes(filter.toLowerCase()))) ?? [];

  const refreshLogs = useCallback(async () => {
    if (!bridge) return;
    const reply = await bridge.logs(project.id);
    if (reply.ok) setLogs(reply.value);
  }, [bridge, project.id]);

  useEffect(() => {
    if (!bridge || project.availability !== 'ready') return;
    let mounted = true;
    void bridge.inspect(project.id).then((reply) => {
      if (mounted && reply.ok) setInfo(reply.value);
      if (mounted && !reply.ok) setError(developerErrors[reply.error] ?? 'Workspace inspection failed.');
    });
    return () => { mounted = false; };
  }, [bridge, project.id, project.availability, signal]);

  useEffect(() => {
    if (!bridge || project.availability !== 'ready') return;
    const timer = window.setInterval(() => void refreshLogs(), 900);
    return () => window.clearInterval(timer);
  }, [bridge, project.availability, refreshLogs]);

  const run: Run = async (label, operation, done) => {
    if (running.current) return;
    running.current = true; setBusy(label); setError(''); setNotice('');
    try {
      const reply = await operation();
      if (reply.ok) done?.(reply.value);
      else setError(developerErrors[reply.error] ?? 'Studio could not complete the operation.');
    } catch { setError('Studio could not reach the desktop service.'); }
    finally { running.current = false; setBusy(''); }
  };

  if (!bridge || project.availability !== 'ready') return <div className="page"><p className="notice">Open an available project in Studio to use these tools.</p></div>;
  const handoff = (action: Handoff['action']) => void run('Opening…', () => bridge.handoff({
    projectId: project.id, action, path: action === 'choose-editor' ? null : target || null,
    line: action === 'editor' && target && line ? Number(line) : null,
    column: action === 'editor' && target && line && column ? Number(column) : null,
  }), (ok) => { if (ok) setNotice(action === 'choose-editor' ? 'VS Code approved for this Studio window.' : 'Sent to the desktop.'); });
  const controls = (id: string, action: 'stop' | 'open' | 'clear') => void run('Updating process…',
    () => bridge.control({ projectId: project.id, id, action }), () => void refreshLogs());
  const reviewCommand = (next: RuntimeTask, port = Number(frontendPort)) => {
    setTask(next); setPreview(undefined);
    void run('Reviewing command…', () => bridge.preview({ projectId: project.id, task: next, frontendPort: port }), setPreview);
  };
  const jump = (link: ArtifactLink) => {
    if (link.kind === 'table') { openTable(link.target); return; }
    setDestination(link);
    setSection(link.kind === 'api' ? 'API Designer' : link.kind === 'page' ? 'Page Designer' : 'Requirements');
  };
  const openDocumentedApi = (entry: NonNullable<typeof api>) => { setApi(entry); setSection('API Playground'); };

  return <div className="page developer-page">
    <header className="page-header">
      <div><h1>Developer Tools</h1><p className="project-path"><bdi>{project.directory}</bdi></p></div>
      <Button className="outlined-button" disabled={Boolean(busy)} onClick={() => void run('Inspecting…', () => bridge.inspect(project.id), setInfo)}>
        <RefreshCw size={15} aria-hidden="true" />Inspect Workspace
      </Button>
    </header>
    <nav className="dev-tabbar" aria-label="Developer tools">
      {(['Runtime', 'API Designer', 'API Playground', 'Page Designer', 'Requirements'] as const).map((item) =>
        <Button key={item} aria-current={section === item ? 'page' : undefined} onClick={() => { setDestination(undefined); setSection(item); }}>{item}</Button>)}
    </nav>
    {error && <p role="alert" className="notice">{error}</p>}
    {(busy || notice) && <p role="status" className="dev-status">{busy || notice}</p>}
    {section === 'Runtime' ? <>
      <section className="project-section" aria-labelledby="dev-handoff">
        <h2 id="dev-handoff">Editor and terminal</h2>
        <div className="dev-row">
          <label>Workspace item <select value={target} onChange={(event) => { setTarget(event.target.value); setLine(''); setColumn(''); }}>
            <option value="">Project root</option>
            {project.entries.filter(({ kind, path }) => kind !== 'link' && !path.startsWith('.factory/') && path !== '.factory')
              .slice(0, 900).map(({ path }) => <option key={path} value={path}>{path}</option>)}
          </select></label>
          <label>Line <input type="number" min="1" value={line} onChange={(event) => {
            setLine(event.target.value);
            if (!event.target.value) setColumn('');
          }} disabled={!project.entries.some(({ kind, path }) => kind === 'file' && path === target)} /></label>
          <label>Column <input type="number" min="1" value={column} onChange={(event) => setColumn(event.target.value)} disabled={!line} /></label>
        </div>
        <div className="dev-actions">
          <Button className="outlined-button" disabled={Boolean(busy)} onClick={() => handoff('editor')}><Code2 size={15} />Open in VS Code</Button>
          <Button className="outlined-button" disabled={Boolean(busy)} onClick={() => handoff('reveal')}><FolderOpen size={15} />Reveal</Button>
          <Button className="outlined-button" disabled={Boolean(busy) || project.entries.some(({ kind, path }) => kind === 'file' && path === target)} onClick={() => handoff('terminal')}><TerminalSquare size={15} />Open Terminal</Button>
          <Button className="outlined-button" disabled={Boolean(busy)} onClick={() => handoff('choose-editor')}>Choose VS Code</Button>
        </div>
      </section>
      <div className="dev-grid">
        <section className="project-section" aria-labelledby="dev-run">
          <h2 id="dev-run">Run and verify</h2>
          {info?.diagnostic && <p className="structure-note">{info.diagnostic}</p>}
          <div className="dev-row">
            <label>Command <select value={task} onChange={(event) => { setTask(event.target.value as RuntimeTask); setPreview(undefined); }}>
              {runtimeTasks.map((item) => <option key={item} value={item}>{taskLabels[item]}</option>)}
            </select></label>
            <label>Frontend port <input type="number" min="1024" max="65535" value={frontendPort}
              onChange={(event) => { setFrontendPort(event.target.value); setPreview(undefined); }} /></label>
          </div>
          <div className="dev-actions">
            <Button className="outlined-button" disabled={!info?.stack || Boolean(busy)} onClick={() => reviewCommand(task)}>Review Command</Button>
          </div>
          {preview && <div className="dev-review">
            <h3>Command preview</h3><bdi className="project-path">{preview.cwd}</bdi>
            <pre tabIndex={0}>{preview.steps.map(({ executable, args }) => JSON.stringify([executable, ...args])).join('\n')}</pre>
            <ul>{preview.environment.map((item) => <li key={item}><code>{item}</code></li>)}</ul>
            <p>Trust only projects you know. Their code runs with your operating system account permissions.</p>
            <Button className="primary-button" disabled={Boolean(busy)} onClick={() => {
              const id = preview.id;
              setPreview(undefined); setLogTask(task);
              void run('Requesting approval…', () => bridge.start({ projectId: project.id, id }), () => void refreshLogs());
            }}><Play size={14} />Approve and Run</Button>
          </div>}
          <dl className="dev-process-list">
            {logs.filter(({ process }) => (runtimeTasks as readonly RuntimeTask[]).includes(process.task)).map(({ process }) => <div key={process.id}>
              <dt>{taskLabels[process.task]}</dt>
              <dd title={'Started ' + process.started + (process.pid ? ' · PID ' + process.pid : '')}><span>{process.state}{process.ready ? ' · listening' : ''}{process.port ? ' · ' + process.port : ''}
                {process.code !== null ? ' · exit ' + process.code : ''}</span>
                {['starting', 'running'].includes(process.state) && <Button disabled={Boolean(busy)} onClick={() => controls(process.id, 'stop')}>Stop {taskLabels[process.task]}</Button>}
                {process.port !== null && ['stopped', 'failed', 'completed'].includes(process.state) &&
                  <Button disabled={Boolean(busy)} onClick={() => reviewCommand(process.task, process.task === 'frontend' ? process.port ?? 5173 : undefined)}>Review Restart</Button>}
                {process.ready && process.task === 'frontend' && <Button disabled={Boolean(busy)} onClick={() => controls(process.id, 'open')}><ArrowUpRight size={14} />Open App</Button>}
              </dd>
            </div>)}
          </dl>
        </section>
        <section className="project-section" aria-labelledby="dev-tools">
          <h2 id="dev-tools">Toolchains and environment</h2>
          <p>{info?.stack ?? 'Workspace inspection'}</p>
          <dl className="dev-facts">{info?.tools.map((tool) => <div key={tool.name}><dt title={tool.executable ?? undefined}>{tool.name}</dt>
            <dd>{tool.version ?? 'Unavailable'}{tool.required ? <small>Required {tool.required}</small> : null}</dd></div>)}</dl>
          <p className="structure-note">{info?.manifests.map(({ name, present }) => name + (present ? ' ✓' : ' unavailable')).join(' · ')}</p>
          <dl className="dev-facts">{info?.environment.map(({ name, configured, sensitive }) => <div key={name}>
            <dt><code>{name}</code></dt><dd>{configured ? 'Configured' : 'Missing from .env'}{sensitive && ' · masked'}</dd>
          </div>)}</dl>
          <div className="dev-row">
            <label>New local .env port <input type="number" min="1024" max="65535" value={localPort} onChange={(event) => setLocalPort(event.target.value)} /></label>
            <Button className="outlined-button" disabled={!info?.stack || !localPort || Boolean(busy)} onClick={() => void run(
              'Reviewing environment…', () => bridge.environment({ projectId: project.id, port: Number(localPort) }),
              (ok) => { if (ok) { setNotice('Local .env created.'); void bridge.inspect(project.id).then((reply) => { if (reply.ok) setInfo(reply.value); }); } },
            )}>Review .env Creation</Button>
          </div>
          <p className="structure-note">Existing .env files and credentials are managed through your external editor.</p>
          <p className="structure-note">Backend port {info?.backendPort ?? 'unavailable'}. Use separate ports and development databases per worktree.</p>
        </section>
      </div>
      <section className="project-section" aria-labelledby="dev-logs">
        <h2 id="dev-logs">Runtime logs</h2>
        <div className="dev-row">
          <label>Process <select value={logTask} onChange={(event) => setLogTask(event.target.value as RuntimeTask)}>
            {runtimeTasks.map((item) => <option key={item} value={item}>{taskLabels[item]}</option>)}
          </select></label>
          <label>Stream <select value={stream} onChange={(event) => setStream(event.target.value as typeof stream)}>
            <option value="all">All streams</option><option value="stdout">Standard output</option><option value="stderr">Standard error</option><option value="studio">Studio</option>
          </select></label>
          <label>Search logs <input type="search" maxLength={256} value={filter} onChange={(event) => setFilter(event.target.value)} /></label>
          <Button className="outlined-button" disabled={!visible.length || Boolean(busy)} onClick={() => {
            if (selectedLogs) void run('Copying logs…', () => bridge.copy({ projectId: project.id, id: selectedLogs.process.id, search: filter, stream }),
              (ok) => { if (ok) setNotice('Visible logs copied.'); });
          }}>Copy Visible</Button>
          <Button className="outlined-button" disabled={!selectedLogs?.lines.length || Boolean(busy)} onClick={() => selectedLogs && controls(selectedLogs.process.id, 'clear')}>Clear Log</Button>
        </div>
        <pre className="dev-output" tabIndex={0}>{visible.length ? visible.map(({ at, stream: channel, text }, index) =>
          <span key={index} data-stream={channel}>{at.slice(11, 23)}  {channel.padEnd(6)}  {text}{'\n'}</span>) : 'No matching output.'}</pre>
      </section>
    </> : section === 'API Playground' ? <Playground key={api?.method + ':' + api?.path} projectId={project.id} backend={liveBackend}
      initial={api} bridge={bridge} busy={Boolean(busy)} run={run} />
      : <DesignWorkspace key={section} project={project} section={section} destination={destination} jump={jump} signal={signal} busy={Boolean(busy)} run={run} openApi={openDocumentedApi} />}
  </div>;
}
