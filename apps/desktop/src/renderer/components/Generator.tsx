import { useEffect, useRef, useState } from 'react';
import { ChevronRight, CircleCheck, FileText, FolderOpen, ShieldCheck } from 'lucide-react';
import { BUILTIN_LIBRARY, IDENTITY_MODULES, isStarterConfig, moduleCompatibility, MODULE_CATALOG, SCHEMA_LIMITS, STANDARD_PROFILE, STARTER, STACKS, stackDefinition, WELCOME_EXAMPLE } from '@factory/contracts';
import type {
  CrudSelection, DatabaseSchema, ErrorCode, LibraryAsset, LibrarySelection, ModuleSelection, GeneratorParent, GeneratorPending, GeneratorPreview, GeneratorReceipt, ProjectSelection, Result, SchemaDiagnostic, StackId, StarterConfig,
} from '@factory/contracts';
import { browserPreview } from '../usePreferences';
import { Button, Dialog, Input } from './Controls';
import { emptySchema, validateCrud } from '@factory/schema';
import { Diagnostics, SchemaDesigner } from './schema/Designer';
import { schemaBridge } from './schema/DatabaseStudio';

import { assetKey, libraryBridge } from './EngineeringLibrary';

export const generatorBridge = browserPreview ? undefined : window.studio?.generator;

const messages: Partial<Record<ErrorCode, string>> = {
  GENERATOR_DESTINATION: 'Choose an available parent outside an existing Git working tree. The project folder must be new.',
  SCHEMA_CONFLICT: 'The selected tables and features cannot be generated together. Review the schema and the optional Welcome example.',
  GENERATOR_STALE: 'The destination or review changed. Check the folder and create a fresh preview.',
  GENERATOR_STORAGE: 'Studio could not read or save the generation journal. Check access to Studio application data.',
  GENERATOR_RECOVERY: 'Generation needs recovery. Open Generation Recovery to inspect and resume the saved operation.',
  GENERATOR_CONFLICT: 'The saved plan or output differs from the current files. Review the folder manually. Studio preserved the existing files.',
  ACCESS_DENIED: 'Choose the parent again to authorize the generation request.',
  PROJECT_BUSY: 'Another generation request is running.',
  PROJECT_LIMIT: 'Close a project tab before generating a new project.',
};

function folderName(name: string) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
    .replace(/^[^a-z]+/u, '').replace(/[^a-z0-9]+/gu, '-').slice(0, 48).replace(/-$/u, '');
}

export function GeneratorDialog({ close, opened, recovery }: {
  close: () => void;
  opened: (selection: ProjectSelection) => void;
  recovery: boolean;
}) {
  const bridge = generatorBridge;
  const [step, setStep] = useState<'project' | 'engineering' | 'review' | 'complete' | 'recovery'>(recovery ? 'recovery' : 'project');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [customSlug, setCustomSlug] = useState(false);
  const [port, setPort] = useState('3000');
  const [stackId, setStackId] = useState<StackId>(STARTER.stack);
  const stack = STACKS[stackId];
  const [welcome, setWelcome] = useState(false);
  const [assets, setAssets] = useState<LibraryAsset[]>([...BUILTIN_LIBRARY]);
  const [profileKey, setProfileKey] = useState(assetKey(STANDARD_PROFILE));
  const [templateKey, setTemplateKey] = useState('');
  const [brand, setBrand] = useState<LibrarySelection['branding']>();
  const [identity, setIdentity] = useState<ModuleSelection[]>([]);
  useEffect(() => {
    let live = true;
    void libraryBridge?.list().then((result) => { if (live && result.ok) setAssets(result.value); });
    return () => { live = false; };
  }, []);
  const [databaseEnabled, setDatabaseEnabled] = useState(false);
  const [schema, setSchema] = useState<DatabaseSchema>(emptySchema);
  const [table, setTable] = useState('');
  const [backend, setBackend] = useState<string[]>([]);
  const [frontend, setFrontend] = useState<string[]>([]);
  const [ddl, setDdl] = useState('');
  const [sqlIssues, setSqlIssues] = useState<SchemaDiagnostic[]>([]);
  const [parent, setParent] = useState<GeneratorParent | null>(null);
  const [plan, setPlan] = useState<GeneratorPreview | null>(null);
  const [receipt, setReceipt] = useState<GeneratorReceipt | null>(null);
  const [file, setFile] = useState('AGENTS.md');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [journal, setJournal] = useState<GeneratorPending[]>();
  const heading = useRef<HTMLHeadingElement>(null);

  const crud: CrudSelection = { schema, migrations: true, backend, frontend };
  const crudIssues = databaseEnabled ? validateCrud(crud) : [];
  const profile = assets.find((item) => assetKey(item) === profileKey && item.kind === 'profile');
  const template = assets.find((item) => assetKey(item) === templateKey && item.kind === 'template');
  const library = (profile && profile.kind === 'profile' && (profile.id !== STANDARD_PROFILE.id || template))
    ? { profile, ...(template?.kind === 'template' ? { template, ...(brand ? { branding: brand } : {}) } : {}) } : undefined;
  const modules = stack.modules ? [...(welcome ? [WELCOME_EXAMPLE] : []), ...identity] : [];
  const compatibility = moduleCompatibility(STARTER.appType, STARTER.database, modules);
  const config: StarterConfig = {
    name: name.trim().normalize('NFC'), slug, port: Number(port),
    appType: STARTER.appType, stack: stack.id, database: STARTER.database,
    architecture: stack.architecture, engineering: STARTER.engineering, modules,
    ...(library ? { library } : {}),
    ...(databaseEnabled ? { crud } : {}),
  };
  const valid = isStarterConfig(config);
  const canReview = valid && crudIssues.length === 0;

  function changeSchema(value: DatabaseSchema) {
    setSchema(value);
    const names = new Set(value.tables.map(({ name }) => name));
    setBackend((current) => current.filter((name) => names.has(name)));
    setFrontend((current) => current.filter((name) => names.has(name)));
  }
  const selectedFile = plan?.files.find((item) => item.path === file);
  const failedReview = Boolean(error && step === 'review');

  useEffect(() => {
    if (step !== 'project') heading.current?.focus();
  }, [step]);

  useEffect(() => {
    if (step !== 'recovery' || !bridge) return;
    let live = true;
    void bridge.pending().then((response) => {
      if (!live) return;
      if (response.ok) setJournal(response.value);
      else {
        setError(messages[response.error] ?? 'Studio could not list interrupted generations.');
        setJournal([]);
      }
    }).catch(() => {
      if (live) {
        setError('Studio could not reach generation recovery.');
        setJournal([]);
      }
    });
    return () => { live = false; };
  }, [bridge, step]);

  async function request<T>(label: string, action: () => Promise<Result<T>>, done: (result: T) => void) {
    if (busy) return;
    setBusy(label);
    setError('');
    try {
      const result = await action();
      if (result.ok) done(result.value);
      else setError(messages[result.error] ?? 'Studio could not complete this generation request.');
    } catch {
      setError('Studio could not reach the desktop generator.');
    } finally {
      setBusy('');
    }
  }

  function showReceipt(result: GeneratorReceipt | null) {
    if (!result) {
      if (step === 'review') {
        setPlan(null);
        setStep('engineering');
      }
      return;
    }
    setReceipt(result);
    setStep('complete');
  }

  function go(next: typeof step) {
    setError('');
    if (next !== 'review') setPlan(null);
    if (next === 'recovery') setJournal(undefined);
    setStep(next);
  }

  return (
    <Dialog title={step === 'recovery' ? 'Generation Recovery' : 'New Project'} className="generator-dialog" onClose={() => { if (!busy) close(); }}>
      <div className="generator-body" aria-busy={Boolean(busy)}>
        {step !== 'recovery' && <ol className="generator-steps" aria-label="New project steps">
          {(['project', 'engineering', 'review', 'complete'] as const).map((item, index) => (
            <li key={item} aria-current={step === item ? 'step' : undefined}>
              {index > 0 && <ChevronRight size={13} aria-hidden="true" />}
              {['Project', 'Engineering', 'Review', 'Done'][index]}
            </li>
          ))}
        </ol>}
        {busy && <p className="generator-state" role="status">{busy}</p>}
        {error && <p className="generator-state generator-state--error" role="alert">{error}</p>}
        {step === 'project' && <form className="generator-section" onSubmit={(event) => {
          event.preventDefault();
          if (valid && parent) go('engineering');
        }}>
          <h3>Project details</h3>
          <div className="generator-fields">
            <label>Application type
              <select defaultValue={STARTER.appType}><option value={STARTER.appType}>Full-stack application</option></select>
            </label>
            <label>Project name
              <Input data-dialog-focus value={name} maxLength={70} placeholder="Inventory Portal" required onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (!customSlug) setSlug(folderName(next));
              }} />
            </label>
            <label>Folder and package name
              <Input value={slug} required maxLength={48} placeholder="inventory-portal" aria-describedby="generator-folder-help"
                onChange={(event) => { setCustomSlug(true); setSlug(event.target.value); }} />
            </label>
            <label>API port
              <Input type="number" value={port} required min={1024} max={65535} onChange={(event) => setPort(event.target.value)} />
            </label>
          </div>
          <p className="generator-muted" id="generator-folder-help">Start the folder name with a lowercase letter. Use lowercase letters, numbers and single hyphens.</p>
          <div className="generator-destination">
            <div>
              <strong>Parent folder</strong>
              <p className="generator-path"><bdi>{parent?.directory ?? 'Choose a local parent folder'}</bdi></p>
            </div>
            <Button className="outlined-button" disabled={Boolean(busy)}
              onClick={() => bridge && void request('Selecting a parent folder…', () => bridge.chooseParent(), (result) => { if (result) setParent(result); })}>
              <FolderOpen size={15} aria-hidden="true" />Choose Folder
            </Button>
          </div>
          <div className="dialog-actions">
            <Button onClick={() => go('recovery')} disabled={Boolean(busy)}>Generation Recovery</Button>
            <Button variant="primary" type="submit" disabled={!parent || !valid || Boolean(busy)}>Continue</Button>
          </div>
        </form>}
        {step === 'engineering' && <section className="generator-section" aria-labelledby="generator-current-step">
          <h3 id="generator-current-step" ref={heading} tabIndex={-1}>Stack and profiles</h3>
          <div className="generator-fields generator-fields--profiles">
            <label>Technology stack<select value={stack.id} onChange={(event) => {
              const selected = stackDefinition(event.target.value);
              if (selected) setStackId(selected.id);
            }}>{Object.values(STACKS).map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
            <label>Architecture profile<select value={stack.architecture} disabled>
              <option value={stack.architecture}>{stack.architectureLabel}</option></select></label>
            <label>Engineering profile<select value={profileKey} onChange={(event) => setProfileKey(event.target.value)}>
              {assets.filter(({ kind }) => kind === 'profile').map((asset) => <option key={assetKey(asset)} value={assetKey(asset)}>{asset.name} · v{asset.version}</option>)}</select></label>
          </div>
          <p className="generator-muted">{stack.backend} · {stack.runtime}</p>
          {libraryBridge && <fieldset className="generator-modules">
            <legend>Application template</legend>
            <label>UI template<select value={templateKey} onChange={(event) => {
              const key = event.target.value;
              setTemplateKey(key);
              const picked = assets.find((item) => item.kind === 'template' && assetKey(item) === key);
              setBrand(picked?.kind === 'template' ? { color: picked.color, mark: picked.mark, theme: picked.theme } : undefined);
            }}><option value="">Foundation layout</option>
              {assets.filter(({ kind }) => kind === 'template').map((asset) => <option key={assetKey(asset)} value={assetKey(asset)}>{asset.name} · v{asset.version}</option>)}</select></label>
            {brand && <div className="generator-fields">
              <label>Primary color<Input type="color" value={brand.color} onChange={(event) => setBrand({ ...brand, color: event.target.value })} /></label>
              <label>Brand mark<Input value={brand.mark} maxLength={4} onChange={(event) => setBrand({ ...brand, mark: event.target.value })} /></label>
              <label>Theme<select value={brand.theme} onChange={(event) => setBrand({ ...brand, theme: event.target.value as typeof brand.theme })}>
                <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
            </div>}
          </fieldset>}
          <fieldset className="generator-modules">
            <legend>Optional features</legend>
            {libraryBridge && stack.modules && <div className="library-module-picks">
              {IDENTITY_MODULES.map((pin) => {
                const item = MODULE_CATALOG.find(({ id }) => id === pin.id)!;
                return <label className="generator-module" key={pin.id}>
                  <input type="checkbox" checked={identity.some(({ id }) => id === pin.id)}
                    aria-label={item.label} onChange={(event) => setIdentity(event.target.checked
                      ? [...identity, pin] : identity.filter(({ id }) => id !== pin.id))} />
                  <span><strong>{item.label} · v{pin.version}</strong><small>{item.requires.length ? 'Requires ' + item.requires.join(', ') : item.description}</small></span>
                </label>;
              })}
              {compatibility.length > 0 && <p role="alert" className="schema-error">{compatibility.join(' ')}</p>}
            </div>}
            {!stack.modules && <p className="generator-muted">Welcome, Authentication, User Management, RBAC and Audit Logging are unavailable for Go. Schema-based CRUD is available below.</p>}
            {stack.modules && <label className="generator-module">
              <input type="checkbox" checked={welcome} disabled={Boolean(busy)}
                aria-describedby="welcome-description" onChange={(event) => setWelcome(event.target.checked)} />
              <span>
                <strong>Welcome example</strong>
                <span className="generator-muted" id="welcome-description">Adds a PostgreSQL-backed API route, React panel, and sample migration.</span>
              </span>
            </label>}
            <details className="generator-planned">
              <summary>Planned options</summary>
              <p className="generator-muted">Backend-only, frontend-only, and database-free templates are planned.</p>
              <ul aria-label="Planned optional modules">
                {MODULE_CATALOG.filter((module) => module.version === null && module.id !== 'crud').map(({ id, label }) =>
                  <li key={id}>{label}</li>)}
              </ul>
            </details>
          </fieldset>
          {schemaBridge && <section className="generator-schema" aria-label="Project database schema">
            <label className="generator-module">
              <input type="checkbox" checked={databaseEnabled} onChange={(event) => setDatabaseEnabled(event.target.checked)} />
              <span><strong>Define a database schema</strong>
                <span className="generator-muted">Include a migration and select which tables need an API or React page.</span>
              </span>
            </label>
            {databaseEnabled && <>
              <details className="generator-planned">
                <summary>Import PostgreSQL DDL</summary>
                <label className="schema-draft-label">PostgreSQL DDL<textarea rows={6} value={ddl} maxLength={SCHEMA_LIMITS.sql}
                  onChange={(event) => { setDdl(event.target.value); setSqlIssues([]); }} /></label>
                <Button className="outlined-button" disabled={!ddl.trim() || Boolean(busy)} onClick={() => {
                  const parser = schemaBridge;
                  if (parser) void request('Parsing SQL locally…', () => parser.parse({ sql: ddl, schema }), (result) => {
                    setSqlIssues(result.diagnostics);
                    if (!result.diagnostics.length) { changeSchema(result.schema); setDdl(''); }
                  });
                }}>Parse SQL</Button>
                <Diagnostics items={sqlIssues} />
              </details>
              <SchemaDesigner selected={table} select={setTable} schema={schema} onChange={changeSchema} />
              {schema.tables.length > 0 && <fieldset className="schema-layers">
                <legend>Generate record management</legend>
                <p className="generator-muted">API routes have no built-in sign-in. Use appropriate network and access controls when deploying.</p>
                {schema.tables.map(({ name }) => <div key={name}><code>{name}</code>
                  <label><input type="checkbox" aria-label={'Backend API for ' + name} checked={backend.includes(name)} onChange={(event) => {
                    setBackend(event.target.checked ? [...backend, name] : backend.filter((item) => item !== name));
                    if (!event.target.checked) setFrontend(frontend.filter((item) => item !== name));
                  }} /> Backend API</label>
                  <label><input type="checkbox" aria-label={'React page for ' + name} checked={frontend.includes(name)} disabled={!backend.includes(name)}
                    onChange={(event) => setFrontend(event.target.checked ? [...frontend, name] : frontend.filter((item) => item !== name))} /> React page</label>
                </div>)}
              </fieldset>}
              <Diagnostics items={schema.tables.length ? crudIssues : []} />
            </>}
          </section>}
          <div className="dialog-actions">
            <Button onClick={() => go('project')} disabled={Boolean(busy)}>Back</Button>
            <Button variant="primary" disabled={!bridge || !parent || !canReview || Boolean(busy)}
              onClick={() => bridge && parent && void request('Inspecting destination and planning files…', () => bridge.preview({ parentId: parent.id, config }), (result) => {
                setPlan(result); setFile('AGENTS.md'); setStep('review');
              })}>Review Files</Button>
          </div>
        </section>}
        {step === 'review' && plan && <section className="generator-section" aria-labelledby="generator-current-step">
          <h3 id="generator-current-step" ref={heading} tabIndex={-1}>Review generation plan</h3>
          <div className="generator-destination">
            <div><strong>{plan.files.length} new files</strong><p className="generator-path"><bdi>{plan.directory}</bdi></p>
              <p className="generator-muted">{stackDefinition(plan.config.stack)?.architectureLabel} · {plan.config.modules.length
                ? plan.config.modules.map(({ id, version }) => (MODULE_CATALOG.find((entry) => entry.id === id)?.label ?? id) + ' v' + version).join(', ')
                : 'Foundation'}{plan.config.crud ? ' · Schema migration · ' + plan.config.crud.backend.length + (plan.config.crud.backend.length === 1 ? ' API · ' : ' APIs · ')
                  + plan.config.crud.frontend.length + (plan.config.crud.frontend.length === 1 ? ' React page' : ' React pages') : plan.config.modules.length ? '' : ' only'}</p></div>
            <ShieldCheck size={19} aria-hidden="true" />
          </div>
          <div className="generator-preview">
            <ul aria-label="Files to create">{plan.files.map((item) => (
              <li key={item.path}>
                <Button title={item.path} aria-pressed={item.path === file} onClick={() => setFile(item.path)}>
                  <FileText size={14} aria-hidden="true" /><span>{item.path}</span>
                </Button>
              </li>
            ))}</ul>
            <section aria-label="File preview">
              <header><bdi>{selectedFile?.path}</bdi><code title={selectedFile?.sha256}>{selectedFile?.sha256.slice(0, 12)}</code></header>
              <pre tabIndex={0} data-wrap={selectedFile?.path.endsWith('.md') ? 'true' : undefined}><code>{selectedFile?.content}</code></pre>
            </section>
          </div>
          <p className="generator-muted">Studio verifies the files after writing them. Install dependencies and apply migrations from your own terminal.</p>
          <div className="dialog-actions">
            <Button onClick={() => go('engineering')} disabled={Boolean(busy)}>Back</Button>
            {failedReview && <Button onClick={() => go('recovery')} disabled={Boolean(busy)}>Generation Recovery</Button>}
            <Button variant="primary" disabled={!bridge || Boolean(busy) || failedReview}
              onClick={() => bridge && void request('Waiting for approval and verifying files…', () => bridge.apply(plan.id), showReceipt)}>Generate Project</Button>
          </div>
        </section>}
        {step === 'complete' && receipt && <section className="generator-section" aria-labelledby="generator-current-step">
          <h3 id="generator-current-step" ref={heading} tabIndex={-1}><CircleCheck size={18} aria-hidden="true" />Project files verified</h3>
          <p>{receipt.fileCount} files matched the approved plan.</p>
          <p className="generator-path"><bdi>{receipt.directory}</bdi></p>
          <p className="generator-muted">Open the generated README for database configuration, development and production commands.</p>
          <div className="dialog-actions">
            {receipt.selection ? <Button variant="primary" onClick={() => {
              if (receipt.selection) opened(receipt.selection);
              close();
            }}>Open Project</Button> : <Button onClick={close}>Done</Button>}
          </div>
        </section>}
        {step === 'recovery' && <section className="generator-section" aria-labelledby="generator-current-step">
          <h3 id="generator-current-step" ref={heading} tabIndex={-1}>Interrupted generations</h3>
          {!journal ? <p role="status">Reading the generation journal…</p>
            : journal.length === 0 ? <p>{error ? 'Generation records are unavailable.' : 'No interrupted generations.'}</p>
              : <ul className="generator-recovery">{journal.map((entry) => <li key={entry.id}>
                <div><strong>{entry.name}</strong><p className="generator-path"><bdi>{entry.directory}</bdi></p>
                  <p className="generator-muted">{entry.createdFiles} files recorded</p></div>
                <div className="generator-recovery-actions">
                  <Button disabled={!bridge || Boolean(busy)} onClick={() => bridge && void request(
                    'Reviewing the recovery handoff…', () => bridge.release(entry.id), setJournal,
                  )}>Close Record</Button>
                  <Button className="outlined-button" disabled={!bridge || Boolean(busy)}
                    onClick={() => bridge && void request('Reviewing the saved generation…', () => bridge.resume(entry.id), showReceipt)}>Resume</Button>
                </div>
              </li>)}</ul>}
          <div className="dialog-actions"><Button onClick={() => go('project')} disabled={Boolean(busy)}>New Project</Button></div>
        </section>}
      </div>
    </Dialog>
  );
}
