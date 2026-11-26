import { useEffect, useState } from 'react';
import { BookOpen, Package } from 'lucide-react';
import { BUSINESS_TEMPLATE, BUILTIN_LIBRARY, isLibraryAsset, MODULE_CATALOG, PROFILE_TOPICS, STANDARD_PROFILE, STARTER } from '@factory/contracts';
import type { LibraryAsset } from '@factory/contracts';
import { browserPreview } from '../usePreferences';
import { Button, Input } from './Controls';

export const libraryBridge = browserPreview ? undefined : window.studio?.library;
export type LibraryPage = 'technology' | 'architecture' | 'templates' | 'modules' | 'profiles' | 'context';
export const libraryPages: readonly LibraryPage[] = ['technology', 'architecture', 'templates', 'modules', 'profiles', 'context'];
export function isLibraryPage(value: string): value is LibraryPage { return (libraryPages as readonly string[]).includes(value); }
export const assetKey = (asset: LibraryAsset) => asset.id + ':' + asset.version;

export const libraryTitles: Record<LibraryPage, string> = {
  technology: 'Technology Catalog', architecture: 'Architecture Library', templates: 'Template Studio',
  modules: 'Module Library', profiles: 'Engineering Profiles', context: 'AI Context',
};

function ProfilePreview({ asset }: { asset: LibraryAsset }) {
  if (asset.kind === 'template') return <div className="library-template" data-theme={asset.theme}>
    <div><strong>{asset.mark || 'BW'}</strong> {asset.name}</div><article><aside>Workspace</aside>
      <section><h3>Records overview</h3><p>Search, create and edit selected business records.</p><label>Brand color <input type="color" aria-label="Preview brand color" value={asset.color} disabled /></label><code>{asset.color} · {asset.theme}</code></section></article>
  </div>;
  return <section className="library-card">
    <h3>Advisory engineering context</h3>
    <p>The generator enforces the verified stack and Layered Web integration. The selected advice is published as readable project documentation.</p>
    <pre>{PROFILE_TOPICS.flatMap((topic) => asset.advice[topic] ? ['## ' + topic + '\n' + asset.advice[topic] + '\n'] : []).join('\n')
      || 'Standard Engineering uses the pinned starter conventions.'}</pre>
  </section>;
}

export function EngineeringLibrary({ page }: { page: LibraryPage }) {
  const [assets, setAssets] = useState<LibraryAsset[]>([...BUILTIN_LIBRARY]);
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<LibraryAsset>();
  const [exchange, setExchange] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const kind = page === 'templates' ? 'template' : 'profile';
  const shown = assets.filter((asset) => asset.kind === kind);
  const current = shown.find((asset) => assetKey(asset) === selected) ?? shown[0]!;
  const editing = draft ?? current;
  const personal = !BUILTIN_LIBRARY.some((asset) => asset.id === current.id);
  const latest = personal && shown.every((asset) => asset.id !== current.id || asset.version <= current.version);

  useEffect(() => {
    let live = true;
    void libraryBridge?.list().then((result) => {
      if (!live) return;
      if (result.ok) setAssets(result.value);
      else setError('The personal library could not be loaded.');
    });
    return () => { live = false; };
  }, []);

  function duplicate(blank: boolean) {
    const source = blank ? (kind === 'profile' ? STANDARD_PROFILE : BUSINESS_TEMPLATE) : current;
    setDraft({ ...source, id: crypto.randomUUID(), version: 1, name: blank ? 'New ' + kind : source.name.slice(0, 53) + ' copy' });
    setError(''); setNotice('');
  }

  async function publish() {
    if (!draft || !isLibraryAsset(draft) || !libraryBridge) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const result = await libraryBridge.publish(draft);
      if (result.ok) {
        setAssets((existing) => [...existing, result.value]); setSelected(assetKey(result.value)); setDraft(undefined);
        setNotice('Published immutable version ' + result.value.version + '.');
      } else setError('This release is stale, the library is full, or the definition conflicts with an existing asset.');
    } catch { setError('The library service could not publish this version.'); }
    finally { setSaving(false); }
  }

  function importDraft() {
    try {
      const incoming: unknown = JSON.parse(exchange);
      if (!isLibraryAsset(incoming) || incoming.kind !== kind) throw new Error('Invalid metadata.');
      // A pasted definition is a new personal asset. Its text and branding stay declarative.
      setDraft({ ...incoming, id: crypto.randomUUID(), version: 1 });
      setError(''); setNotice('Imported into a reviewable draft.');
    } catch { setError('Use the supported JSON definition for this asset type. Remove executable content and credentials.'); }
  }

  return <section className="schema-panel engineering-library" aria-label={libraryTitles[page]}>
    <header className="schema-header"><div className="schema-title"><BookOpen size={22} aria-hidden="true" /><div>
      <h2>{libraryTitles[page]}</h2><p>Pinned, reusable project assets</p></div></div></header>
    {page === 'technology' && <div className="library-card">
      <h3>{STARTER.stackLabel}</h3>
      <dl className="library-specs"><dt>Runtime</dt><dd>Node.js 22.16.0 · pnpm 10.13.1</dd>
        <dt>Backend</dt><dd>TypeScript 6.0.3 · Express 5.2.1 · pg 8.22.0</dd>
        <dt>Frontend</dt><dd>React 19.3.1 · Vite 8.3.8</dd>
        <dt>Database</dt><dd>PostgreSQL 17 reference runtime</dd>
        <dt>Supported projects</dt><dd>Full-stack applications with Layered Web v1</dd>
        <dt>Generator</dt><dd>Project creation, schema-based CRUD and reviewed incremental module installation</dd></dl>
      <p className="schema-muted">Additional stacks, backend-only and frontend-only generation are planned.</p>
    </div>}
    {page === 'architecture' && <div className="library-card"><h3>Layered Web · v1</h3>
      <dl className="library-specs"><dt>Controllers</dt><dd>Translate HTTP requests and responses</dd>
        <dt>Services</dt><dd>Hold application behavior and validation boundaries</dd>
        <dt>Repositories</dt><dd>Isolate parameterized PostgreSQL operations</dd>
        <dt>React</dt><dd>Use the same-origin API and approved feature integrations</dd>
        <dt>Compatibility</dt><dd>All verified Node/PostgreSQL module releases and engineering profiles</dd></dl>
      <p className="schema-muted">Additional architecture adapters are planned.</p>
    </div>}
    {page === 'modules' && <div className="library-modules">{MODULE_CATALOG.map((item) => <article key={item.id} className="library-card">
      <h3><Package aria-hidden="true" size={16} />{item.label} <small>{item.version ? 'v' + item.version : 'Planned'}</small></h3>
      {item.version && <>
        <p>{item.description ?? 'Optional sample module for the verified starter.'}</p>
        <p>Full-stack · Node / PostgreSQL · Layered Web v1 · all verified engineering profiles</p>
        <p>{item.requires.length ? 'Requires ' + item.requires.join(', ') : 'No module dependencies'}{item.runtime ? ' · ' + item.runtime : ''}</p>
        {item.artifacts && <ul>{item.artifacts.map((name) => <li key={name}>{name}</li>)}</ul>}
      </>}
      {item.settings && <dl className="library-specs">{item.settings.map(({ name, required, usage }) =>
        <div key={name}><dt><code>{name}</code></dt><dd>{required ? 'Required. ' : 'Optional. '}{usage}</dd></div>)}</dl>}
    </article>)}</div>}
    {(page === 'profiles' || page === 'templates' || page === 'context') && <>
      <div className="library-toolbar">
        <label>Version<select value={assetKey(current)} onChange={(event) => {
          setSelected(event.target.value); setDraft(undefined); setError('');
        }}>{shown.map((asset) => <option key={assetKey(asset)} value={assetKey(asset)}>{asset.name} · v{asset.version}</option>)}</select></label>
        <Button onClick={() => duplicate(true)}>Create new</Button><Button onClick={() => duplicate(false)}>Duplicate</Button>
        <Button disabled={!latest} onClick={() => setDraft(current)}>Draft next version</Button>
      </div>
      {error && <p role="alert" className="schema-message schema-error">{error}</p>}
      {notice && <p role="status" className="schema-message schema-success">{notice}</p>}
      {draft && latest ? <div className="library-fields"><section><h3>Published version</h3><ProfilePreview asset={current} /></section>
        <section><h3>Draft preview</h3><ProfilePreview asset={editing} /></section></div> : <ProfilePreview asset={editing} />}
      {draft && <section className="library-card library-editor" aria-label="Asset draft">
        <h3>Version draft</h3>
        <label>Name<Input value={draft.name} maxLength={60} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        {draft.kind === 'profile' ? <>
          <p>Keep credentials and confidential client requirements out of these portable instructions.</p>
          <div className="library-fields">{(page === 'context' ? (['AI coding', 'Documentation', 'Testing'] as const) : PROFILE_TOPICS).map((topic) =>
            <label key={topic}>{topic}<Input value={draft.advice[topic] ?? ''} maxLength={320}
              onChange={(event) => setDraft({ ...draft, advice: { ...draft.advice, [topic]: event.target.value } })} /></label>)}</div>
        </> : <div className="library-fields">
          <label>Primary color<Input type="color" value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>
          <label>Theme<select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as typeof draft.theme })}>
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
          <label>Brand mark<Input value={draft.mark} maxLength={4} onChange={(event) => setDraft({ ...draft, mark: event.target.value })} /></label>
        </div>}
        {!isLibraryAsset(draft) && <p role="alert">Review the name and values. An instruction may contain a URL, control character or credential-like assignment.</p>}
        <div className="library-toolbar"><Button onClick={() => setDraft(undefined)}>Discard draft</Button>
          <Button variant="primary" disabled={saving || !isLibraryAsset(draft)} onClick={() => void publish()}>Publish version</Button></div>
      </section>}
      <details className="library-card"><summary>Import or export definition</summary>
        <div className="library-toolbar"><Button onClick={() => setExchange(JSON.stringify(current, null, 2))}>Export JSON for copying</Button>
          <Button disabled={!exchange} onClick={importDraft}>Import JSON into draft</Button></div>
        <label>Portable JSON<textarea rows={8} maxLength={10_000} value={exchange} onChange={(event) => setExchange(event.target.value)} /></label>
        <p>Share reviewed definitions through ordinary Git repositories or files.</p>
      </details>
    </>}
  </section>;
}
