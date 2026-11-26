import { useEffect, useState } from 'react';
import { ArrowUpRight, FilePlus2, Link2, Send } from 'lucide-react';
import { formatOpenApi, httpMethods, isDesignEntry, isPlaygroundRequest } from '@factory/contracts';
import type { ArtifactLink, DesignEntry, DesignSnapshot, DeveloperBridge, HttpMethod, HttpPair,
  IncrementalPreview, OpenProject, PlaygroundResponse, Result, RuntimeProcess } from '@factory/contracts';
import { browserPreview } from '../usePreferences';
import { Button } from './Controls';
import { ChangePreview, incrementalBridge } from './GenerationReview';
import type { DeveloperSection } from './Developer';

type Api = Extract<DesignEntry, { kind: 'api' }>;
type Run = <T>(label: string, operation: () => Promise<Result<T>>, done?: (value: T) => void) => Promise<void>;
const designBridge = browserPreview ? undefined : window.studio?.design;
const handoffBridge = browserPreview ? undefined : window.studio?.developer;

function pairs(text: string): HttpPair[] {
  return text.split('\n').filter((line) => line.trim()).map((line) => {
    const index = line.indexOf('=');
    return index > 0 ? [line.slice(0, index).trim(), line.slice(index + 1).trim()] : ['', ''];
  });
}

export function Playground({ projectId, backend, initial, bridge, busy, run }: {
  projectId: string; backend: RuntimeProcess | undefined; initial?: { path: string; method: string; query: string[] } | undefined;
  bridge: DeveloperBridge; busy: boolean; run: Run;
}) {
  const [path, setPath] = useState(initial?.path ?? '/api/health');
  const [method, setMethod] = useState<HttpMethod>(() => httpMethods.find((item) => item === initial?.method) ?? 'GET');
  const [query, setQuery] = useState(initial?.query.map((name) => name + '=').join('\n') ?? '');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<PlaygroundResponse>();
  const [error, setError] = useState('');
  const [history, setHistory] = useState<{ method: HttpMethod; status: number; duration: number }[]>([]);
  return <section className="project-section" aria-labelledby="playground-title">
    <h2 id="playground-title">Local request</h2>
    <p>{backend ? 'Studio backend at http://127.0.0.1:' + backend.port : 'Start this worktree’s backend in Runtime to send requests.'}</p>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (!backend) return;
      setResponse(undefined);
      const input = { projectId, backendId: backend.id, method, path, query: pairs(query), headers: pairs(headers), body };
      if (!isPlaygroundRequest(input)) { setError('Use a local /api/ path and one name=value pair per line.'); return; }
      setError('');
      void run('Sending request…', () => bridge.request(input), (value) => {
        setResponse(value);
        setHistory((items) => [{ method, status: value.status, duration: value.duration }, ...items].slice(0, 8));
      });
    }}>
      <div className="dev-row">
        <label>HTTP method <select value={method} onChange={(event) => setMethod(event.target.value as HttpMethod)}>
          {httpMethods.map((item) => <option key={item}>{item}</option>)}
        </select></label>
        <label className="dev-grow">Endpoint path <input value={path} onChange={(event) => setPath(event.target.value)} required /></label>
        <Button type="submit" className="primary-button" disabled={!backend || busy}><Send size={14} />Review and Send</Button>
      </div>
      <div className="dev-grid">
        <label>Query parameters <textarea value={query} placeholder={'limit=25\noffset=0'} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>Headers <textarea value={headers} placeholder="Accept=application/json" onChange={(event) => setHeaders(event.target.value)} autoComplete="off" spellCheck={false} /></label>
      </div>
      <label>JSON request body <textarea className="dev-mono" value={body} maxLength={32768} onChange={(event) => setBody(event.target.value)} spellCheck={false} /></label>
      {error && <p role="alert" className="notice">{error}</p>}
    </form>
    <div className="dev-grid dev-response">
      <section aria-labelledby="dev-response-title">
        <h3 id="dev-response-title">Response</h3>
        {response ? <>
          <p role="status">{response.status} · {response.duration} ms</p>
          <details><summary>Response headers</summary><pre className="dev-output" tabIndex={0}>{response.headers.map(([name, value]) => name + ': ' + value).join('\n')}</pre></details>
          <pre className="dev-output" tabIndex={0}>{response.body || 'Empty response body.'}</pre>
        </> : <p className="structure-note">Send an approved request to see the response.</p>}
      </section>
      <section aria-labelledby="dev-http-history">
        <h3 id="dev-http-history">Tab history</h3>
        {history.length ? <ol>{history.map((item, index) => <li key={index}>{item.method} · {item.status} · {item.duration} ms</li>)}</ol>
          : <p className="structure-note">No requests sent.</p>}
      </section>
    </div>
  </section>;
}

const normalized = (value: string) => value.split(',').map((part) => part.trim()).filter(Boolean);
const options = (value: ArtifactLink[]) => value.map(({ kind, target }) => kind + '=' + target).join('\n');
function links(value: string): ArtifactLink[] {
  return pairs(value).map(([kind, target]) => ({ kind: kind as ArtifactLink['kind'], target }));
}

function newDraft(kind: DesignEntry['kind']): DesignEntry {
  const base = { id: '', title: '' };
  if (kind === 'api') return { ...base, kind, method: 'GET', path: '/api/', query: [], request: '', response: '', auth: 'none', permission: '', source: '' };
  if (kind === 'page') return { ...base, kind, layout: 'summary', api: '', columns: [], description: '' };
  if (kind === 'workflow') return { ...base, kind, description: '', steps: [{ title: '', links: [] }] };
  return { ...base, kind, description: '', criteria: '', links: [] };
}

function OpenApi({ entries, save }: { entries: Api[]; save(): void }) {
  const [open, setOpen] = useState(false);
  if (!entries.length) return null;
  return <>
    <div className="dev-actions">
      <Button className="outlined-button" onClick={() => setOpen(!open)} aria-expanded={open}>Preview OpenAPI</Button>
      {open && <Button className="outlined-button" onClick={save}>Export OpenAPI JSON</Button>}
    </div>
    {open && <textarea className="dev-mono" readOnly value={formatOpenApi(entries)} aria-label="OpenAPI export" />}
  </>;
}

export function DesignWorkspace({ project, section, destination, jump, signal, busy, run, openApi }: {
  project: OpenProject; section: Exclude<DeveloperSection, 'Runtime' | 'API Playground'>; destination: ArtifactLink | undefined; jump(link: ArtifactLink): void; signal: string; busy: boolean; run: Run;
  openApi: (entry: Api) => void;
}) {
  const type = section === 'API Designer' ? 'api' : section === 'Page Designer' ? 'page' : 'requirement';
  const [snapshot, setSnapshot] = useState<DesignSnapshot>();
  const [draft, setDraft] = useState<DesignEntry>(() => newDraft(type));
  const [preview, setPreview] = useState<IncrementalPreview>();
  const [selected, setSelected] = useState('');
  const [problem, setProblem] = useState('');
  const [notice, setNotice] = useState('');
  const patch = (value: Partial<DesignEntry>) => { setDraft({ ...draft, ...value } as DesignEntry); setPreview(undefined); };
  const change = preview?.changes.find(({ path }) => path === selected) ?? preview?.changes[0];

  useEffect(() => {
    if (!designBridge) return;
    let live = true;
    void designBridge.inspect(project.id).then((result) => {
      if (live && result.ok) {
        setSnapshot(result.value);
        if (destination) {
          const entry = result.value.entries.find(({ entry: item }) => item.kind === destination.kind && item.id === destination.target)?.entry
            ?? (destination.kind === 'api' ? result.value.generated.find(({ id }) => id === destination.target) : undefined);
          if (entry) { setDraft(entry); setPreview(undefined); }
        }
      }
      if (live && !result.ok && result.error !== 'PROJECT_BUSY') setProblem('Design tools require a compatible generated workspace and valid portable metadata.');
    });
    return () => { live = false; };
  }, [project.id, signal, destination]);

  const inspect = () => {
    const bridge = designBridge;
    if (bridge) void run('Inspecting designs…', () => bridge.inspect(project.id), (value) => { setSnapshot(value); setProblem(''); });
  };
  const review = (generate: boolean) => {
    const bridge = incrementalBridge;
    if (!bridge) return;
    setNotice(''); setPreview(undefined);
    const submitted = draft.kind === 'api' ? { ...draft, query: normalized(draft.query.join(',')) }
      : draft.kind === 'page' ? { ...draft, columns: normalized(draft.columns.join(',')) } : draft;
    if (!isDesignEntry(submitted)) { setProblem('Check the ID, fields and artifact references. Keep credentials out of shared designs.'); return; }
    setProblem('');
    void run<IncrementalPreview>('Planning design…', async () => {
      const inspection = await bridge.inspect(project.id);
      if (!inspection.ok) return inspection;
      return bridge.preview({ projectId: project.id, revision: inspection.value.revision, backend: [], frontend: [], design: { entry: submitted, generate } });
    }, (value) => { setPreview(value); setSelected(value.changes[0]?.path ?? ''); });
  };
  const apply = () => {
    const bridge = incrementalBridge;
    if (!bridge || !preview) return;
    const id = preview.id;
    void run<DesignSnapshot | null>('Applying reviewed plan…', async () => {
      const result = await bridge.apply({ projectId: project.id, id });
      if (!result.ok || !result.value || !designBridge) return result.ok ? { ok: true, value: null } : result;
      return designBridge.inspect(project.id);
    }, (result) => {
      if (!result) return;
      setSnapshot(result); setPreview(undefined); setNotice('Reviewed design saved.');
    });
  };
  const reveal = (path: string) => {
    if (handoffBridge) void run('Opening source…', () => handoffBridge.handoff({
      projectId: project.id, action: 'editor', path, line: null, column: null,
    }));
  };
  const matching = snapshot?.entries.filter(({ entry }) => entry.kind === type || (type === 'requirement' && entry.kind === 'workflow')) ?? [];
  const endpoints = snapshot?.generated ?? [];
  const designedApis = (snapshot?.entries ?? []).flatMap(({ entry }) => entry.kind === 'api' ? [entry] : []);

  return <>
    {problem && <p className="notice" role="alert">{problem}</p>}
    {notice && <p className="dev-status" role="status">{notice}</p>}
    <div className="dev-grid">
      <section className="project-section" aria-labelledby="dev-artifacts">
        <h2 id="dev-artifacts">{section}</h2>
        <div className="dev-actions">
          <Button className="outlined-button" disabled={busy} onClick={inspect}>Refresh Artifacts</Button>
          {type === 'requirement' && <Button className="outlined-button" disabled={busy} onClick={() => { setDraft(newDraft('workflow')); setPreview(undefined); }}>New Workflow</Button>}
          <Button className="outlined-button" disabled={busy} onClick={() => { setDraft(newDraft(type)); setPreview(undefined); }}><FilePlus2 size={14} />New {type === 'api' ? 'Endpoint' : type === 'page' ? 'Page' : 'Requirement'}</Button>
        </div>
        <ul className="dev-artifact-list">
          {matching.map(({ entry, source, state, links: resolved }) => <li key={entry.kind + ':' + entry.id}>
            <div><Button onClick={() => { setDraft(entry); setPreview(undefined); }}>{entry.title}</Button><small>{entry.kind} · {state}</small></div>
            {source && <Button className="outlined-button" onClick={() => reveal(source)}><Link2 size={13} />Source</Button>}
            {entry.kind === 'api' && <Button className="outlined-button" onClick={() => openApi(entry)}>Open Request</Button>}
            {resolved.length > 0 && <ul>{resolved.map(({ link, state: linkState }, index) => <li key={index}>
              {link.kind === 'source' && linkState !== 'missing'
                ? <Button onClick={() => reveal(link.target)}>{link.target}</Button>
                : linkState !== 'missing' ? <Button onClick={() => jump(link)}>{link.kind}: {link.target}</Button>
                  : <span>{link.kind}: {link.target}</span>} <small>{linkState}</small>
            </li>)}</ul>}
          </li>)}
        </ul>
        {!matching.length && <p className="structure-note">No saved {type === 'api' ? 'designs' : type === 'page' ? 'pages' : 'requirements or workflows'}.</p>}
        {type === 'api' && <>
          <h3>Verified source routes</h3>
          <ul className="dev-artifact-list">
            {endpoints.map((entry) => <li key={entry.id}><div><bdi>{entry.method} {entry.path}</bdi><small>{entry.source}</small></div>
              <Button className="outlined-button" onClick={() => { setDraft(entry); setPreview(undefined); }}>Use Definition</Button>
              <Button className="outlined-button" onClick={() => openApi(entry)}><ArrowUpRight size={14} />Request</Button>
            </li>)}
          </ul>
          {!endpoints.length && <p className="structure-note">No matching built-in route sources were found.</p>}
          <OpenApi entries={designedApis} save={() => {
            const bridge = designBridge;
            if (bridge) void run('Exporting OpenAPI…', () => bridge.export(project.id), (ok) => { if (ok) setNotice('OpenAPI exported.'); });
          }} />
        </>}
      </section>
      <section className="project-section dev-design-form" aria-labelledby="dev-editor">
        <h2 id="dev-editor">Edit {draft.kind === 'api' ? 'endpoint' : draft.kind}</h2>
        <div className="dev-row"><label>Design ID <input value={draft.id} onChange={(event) => patch({ id: event.target.value })} placeholder="lowercase-id" /></label>
          <label className="dev-grow">Title <input value={draft.title} onChange={(event) => patch({ title: event.target.value })} /></label></div>
        {draft.kind === 'api' ? <>
          <div className="dev-row"><label>Method <select value={draft.method} onChange={(event) => patch({ method: event.target.value as HttpMethod })}>
            {httpMethods.map((item) => <option key={item}>{item}</option>)}
          </select></label><label className="dev-grow">Design path <input value={draft.path} onChange={(event) => patch({ path: event.target.value })} /></label></div>
          <label>Query parameters <input value={draft.query.join(',')} onChange={(event) => patch({ query: event.target.value.split(',') })} placeholder="limit,offset,q" /></label>
          <label>Request body and validation <textarea value={draft.request} onChange={(event) => patch({ request: event.target.value })} /></label>
          <label>Response contract <textarea value={draft.response} onChange={(event) => patch({ response: event.target.value })} /></label>
          <div className="dev-row"><label>Authentication <select value={draft.auth} onChange={(event) => patch({ auth: event.target.value as Api['auth'] })}><option value="none">None</option><option value="session">Session</option></select></label>
            <label>Required permission <input value={draft.permission} onChange={(event) => patch({ permission: event.target.value })} /></label></div>
          <label>Linked source file <input value={draft.source} onChange={(event) => patch({ source: event.target.value })} /></label>
        </> : draft.kind === 'page' ? <>
          <p className="structure-note">Published route <code>/studio-page.html</code>. One page is available for Node Business Workspace projects without authentication.</p>
          <label>Layout <select value={draft.layout} onChange={(event) => patch({ layout: event.target.value as 'summary' | 'table' })}>
            <option value="summary">Summary</option><option value="table">Data table</option>
          </select></label>
          <label>Data source <select value={draft.api} onChange={(event) => patch({ api: event.target.value })}>
            <option value="">None</option>{endpoints.filter(({ method }) => method === 'GET').map((entry) => <option key={entry.id} value={entry.id}>{entry.path}</option>)}
          </select></label>
          {draft.layout === 'table' && <label>Table columns <input value={draft.columns.join(',')} onChange={(event) => patch({ columns: event.target.value.split(',') })} placeholder="id,name" /></label>}
          <label>Page introduction <textarea value={draft.description} onChange={(event) => patch({ description: event.target.value })} /></label>
          <div className="dev-review"><h3>{draft.title || 'Page title'}</h3><p>{draft.description || 'Page introduction'}</p>
            {draft.layout === 'table' && <p className="structure-note">{normalized(draft.columns.join(',')).join(' · ') || 'Choose table columns.'}</p>}</div>
        </> : <>
          <label>Description <textarea value={draft.description} onChange={(event) => patch({ description: event.target.value })} /></label>
          {draft.kind === 'requirement' ? <>
            <label>Acceptance criteria <textarea value={draft.criteria} onChange={(event) => patch({ criteria: event.target.value })} /></label>
            <label>Artifact references <textarea key={draft.id} defaultValue={options(draft.links)} onBlur={(event) => patch({ links: links(event.target.value) })} placeholder={'table=products\napi=list-products\npage=inventory\nsource=web/main.tsx'} /></label>
          </> : <div className="dev-workflow">
            <p className="structure-note">Steps document the workflow and reference real artifacts.</p>
            {draft.steps.map((step, index) => <fieldset key={index}>
              <legend>Step {index + 1}</legend>
              <label>Step title <input value={step.title} onChange={(event) => patch({ steps: draft.steps.map((item, i) => i === index ? { ...item, title: event.target.value } : item) })} /></label>
              <label>Step references <textarea key={draft.id} defaultValue={options(step.links)} onBlur={(event) =>
                patch({ steps: draft.steps.map((item, i) => i === index ? { ...item, links: links(event.target.value) } : item) })} placeholder="requirement=review-stock" /></label>
              {draft.steps.length > 1 && <Button className="outlined-button" onClick={() => patch({ steps: draft.steps.filter((_, i) => i !== index) })}>Remove Step</Button>}
            </fieldset>)}
            <Button className="outlined-button" disabled={draft.steps.length >= 12} onClick={() => patch({ steps: [...draft.steps, { title: '', links: [] }] })}>Add Step</Button>
          </div>}
        </>}
        <div className="dev-actions">
          <Button className="outlined-button" disabled={!snapshot || busy} onClick={() => review(false)}>Review Save</Button>
          {draft.kind === 'page' && <Button className="outlined-button" disabled={!snapshot || busy} onClick={() => review(true)}>Review Page Generation</Button>}
        </div>
      </section>
    </div>
    {preview && <section className="project-section" aria-labelledby="dev-plan">
      <h2 id="dev-plan">Generation review</h2>
      {preview.issues.length > 0 && <ul role="alert" className="notice">{preview.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      <div className="dev-actions">{preview.changes.map(({ path }) => <Button key={path} className="outlined-button" aria-pressed={change?.path === path} onClick={() => setSelected(path)}>{path}</Button>)}</div>
      {change && <article className="incremental-preview"><ChangePreview change={change} /></article>}
      {!preview.changes.length && !preview.issues.length && <p>This design matches the saved version.</p>}
      <Button className="primary-button" disabled={busy || preview.issues.length > 0 || !preview.changes.length} onClick={apply}>Approve and Apply</Button>
    </section>}
  </>;
}
