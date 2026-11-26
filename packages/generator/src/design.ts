import { DESIGN_PATH, GENERATOR_LIMITS, GO_STACK, isDesignDocument, isRecord } from '@factory/contracts';
import type { ArtifactLink, DatabaseSchema, DesignDocument, DesignEntry, DesignMutation, DesignSnapshot, IncrementalChange } from '@factory/contracts';
import { planProject, sha256 } from './index';
import type { LocalFile, VersionedProject } from './incremental';

const manifestPath = '.factory/generation-manifest.json';
const vite = 'vite.config.ts';
export const pageFiles = ['web/studio-page.html', 'web/features/StudioPage.tsx', 'docs/STUDIO_PAGE.md'] as const;
export const designInputs = [DESIGN_PATH, vite, ...pageFiles, 'server/features/crud/register.ts', 'internal/httpapp/http.go', 'internal/records/handler.go'];
export const isDesignWritePath = (path: string) => path === DESIGN_PATH || path === vite || pageFiles.some((value) => value === path);
export const isPageOwnership = (path: string, owner: string, stack: string) => stack !== GO_STACK && owner === stack
  && pageFiles.some((value) => value === path);

const pretty = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
export type Api = Extract<DesignEntry, { kind: 'api' }>;

export function readDesign(file?: LocalFile): DesignDocument {
  if (!file || file.state === 'absent') return { version: 1, records: [] };
  if (file.state === 'text') {
    try {
      const data: unknown = JSON.parse(file.content);
      if (isDesignDocument(data)) return data;
    } catch { /* Inspection reports an invalid portable document. */ }
  }
  throw new Error('The portable design file is invalid or outside the supported format.');
}

export function artifactLinks(entry: DesignEntry): ArtifactLink[] {
  if (entry.kind === 'requirement') return entry.links;
  if (entry.kind === 'workflow') return entry.steps.flatMap(({ links }) => links);
  if (entry.kind === 'page') return entry.api ? [{ kind: 'api', target: entry.api }] : [];
  return entry.source ? [{ kind: 'source', target: entry.source }] : [];
}

export function generatedEndpoints(project: VersionedProject, files: ReadonlyMap<string, LocalFile>): Api[] {
  const isGo = project.config.stack === GO_STACK;
  const owned = (path: string) => {
    const local = files.get(path);
    return local?.state === 'text' && project.files.some((entry) => entry.path === path && entry.sha256 === local.sha256);
  };
  const result: Api[] = [];
  const route = isGo ? 'internal/httpapp/http.go' : 'server/routes.ts';
  const register = isGo ? 'internal/records/handler.go' : 'server/features/crud/register.ts';
  const identity = project.config.modules.some(({ id }) => id === 'authentication');
  const api = (id: string, title: string, method: Api['method'], path: string, source: string, query: string[],
    auth: Api['auth'], response: string): Api =>
    ({ kind: 'api', id, title, method, path, source, query, auth, response, request: '', permission: '' });
  if (owned(route)) result.push(api('health', 'API health', 'GET', '/api/health', route, [], 'none', '{"data":{"status":"ok"}}'),
    api('ready', 'Database readiness', 'GET', '/api/ready', route, [], 'none', '{"data":{"status":"ready"}}'));
  if (!owned(route) || !owned(register)) return result;
  for (const table of project.previous?.backend ?? []) {
    const id = table.replaceAll('_', '-');
    if (id.length > 32) continue;
    const path = '/api/crud/' + table;
    const auth = identity ? 'session' : 'none';
    result.push(api('list-' + id, 'List ' + table, 'GET', path, register, ['limit', 'offset', 'q'], auth, '{"data":{"rows":[]}}'));
    result.push(api('create-' + id, 'Create ' + table, 'POST', path, register, [], auth, 'Record'));
    result.push(api('get-' + id, 'Get ' + table, 'GET', path + '/record', register, ['id'], auth, 'Record'));
    result.push(api('edit-' + id, 'Update ' + table, 'PATCH', path + '/record', register, ['id'], auth, 'Record'));
    result.push(api('delete-' + id, 'Delete ' + table, 'DELETE', path + '/record', register, ['id'], auth, 'Deletion outcome'));
  }
  return result;
}

function digestFor(link: ArtifactLink, document: DesignDocument, schema: DatabaseSchema, files: ReadonlyMap<string, LocalFile>, generated: Api[]) {
  if (link.kind === 'source') {
    const file = files.get(link.target);
    return file?.state === 'text' ? file.sha256 : null;
  }
  if (link.kind === 'table') {
    const table = schema.tables.find(({ name }) => name === link.target);
    return table ? sha256(JSON.stringify(table)) : null;
  }
  const entry = document.records.find(({ entry }) => entry.kind === link.kind && entry.id === link.target)?.entry
    ?? (link.kind === 'api' ? generated.find(({ id }) => id === link.target) : undefined);
  if (!entry) return null;
  if (entry.kind === 'api' && entry.source) {
    const source = files.get(entry.source);
    return source?.state === 'text' ? sha256(JSON.stringify([entry, source.sha256])) : null;
  }
  if (entry.kind === 'page') {
    const guide = files.get(pageFiles[2]);
    if (guide?.state === 'text' && guide.content.startsWith('# Studio page: ' + entry.id + '\n')) {
      const page = files.get(pageFiles[1]);
      return page?.state === 'text' ? sha256(JSON.stringify([entry, page.sha256])) : null;
    }
  }
  return sha256(JSON.stringify(entry));
}

export function describeDesign(project: VersionedProject, files: ReadonlyMap<string, LocalFile>, schema: DatabaseSchema): DesignSnapshot {
  const document = readDesign(files.get(DESIGN_PATH));
  const generated = generatedEndpoints(project, files);
  return {
    generated,
    entries: document.records.map(({ entry, references }) => {
      const endpoint = entry.kind === 'api' && generated.find((api) => api.path === entry.path && api.method === entry.method && api.source === entry.source);
      const page = entry.kind === 'page' && project.files.some(({ path }) => path === pageFiles[0])
        && files.get(pageFiles[2]);
      const implementedPage = page && page.state === 'text' && page.content.startsWith('# Studio page: ' + entry.id + '\n')
        && pageFiles.every((path) => {
          const local = files.get(path);
          return local?.state === 'text' && project.files.some((item) => item.path === path && item.sha256 === local.sha256);
        });
      const links = references.map(({ link, digest }) => {
        const observed = digestFor(link, document, schema, files, generated);
        return { link, state: observed === null ? 'missing' as const : observed === digest ? 'current' as const : 'changed' as const };
      });
      return { entry, state: endpoint || implementedPage ? 'implemented' : page || links.some(({ state }) => state === 'changed') ? 'changed' : 'planned',
        source: endpoint ? endpoint.source : implementedPage ? pageFiles[1] : entry.kind === 'api' ? entry.source || null : null, links };
    }),
  };
}

function renderPage(entry: Extract<DesignEntry, { kind: 'page' }>, endpoint: Api | undefined) {
  const title = JSON.stringify(entry.title);
  const description = JSON.stringify(entry.description);
  const columns = JSON.stringify(entry.columns);
  const fetchCode = endpoint ? `
  const [data, setData] = useState<unknown>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(${JSON.stringify(endpoint.path)}, { signal: abort.signal }).then(async (response) => {
      if (!response.ok) throw new Error('Request failed.');
      const body = await response.json() as { data: unknown };
      setData(body.data ?? null);
    }).catch(() => { if (!abort.signal.aborted) setFailed(true); });
    return () => abort.abort();
  }, []);
  ${entry.layout === 'table' ? `const records = typeof data === 'object' && data !== null && 'rows' in data && Array.isArray(data.rows) ? data.rows as Record<string, unknown>[] : [];
  const columns: string[] = ${columns};` : ''}
  const content = failed ? <p role="alert">The data request failed.</p> : data === undefined ? <p role="status">Loading…</p>
    : ${entry.layout === 'table' ? '<><h2>Records</h2>{records.length === 0 ? <p>No records found.</p> : <table><thead><tr>{columns.map((column) => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{records.map((record, index) => <tr key={index}>{columns.map((column) => <td key={column}>{String(record[column] ?? "")}</td>)}</tr>)}</tbody></table>}</>' : '<pre>{JSON.stringify(data, null, 2)}</pre>'};
` : '';
  const code = `${endpoint ? "import { useEffect, useState } from 'react';\n" : ''}import { createRoot } from 'react-dom/client';
import { BusinessShell } from './business/BusinessShell.tsx';
import '../styles.css';

function StudioPage() {${fetchCode}
  return <BusinessShell><main><h1>{${title}}</h1><p>{${description}}</p>${endpoint ? '{content}' : ''}</main></BusinessShell>;
}

const target = document.getElementById('root');
if (!target) throw new Error('Application root is missing.');
createRoot(target).render(<StudioPage />);
`;
  return code;
}

export function composeDesign(project: VersionedProject, files: ReadonlyMap<string, LocalFile>, schema: DatabaseSchema, mutation: DesignMutation) {
  const { entry } = mutation;
  const document = readDesign(files.get(DESIGN_PATH));
  const generated = generatedEndpoints(project, files);
  const references = artifactLinks(entry).map((link) => ({ link, digest: digestFor(link, document, schema, files, generated) }));
  const changes: IncrementalChange[] = [];
  const issues: string[] = [];
  const result = { changes, issues, backend: [], frontend: [] };
  const write = (path: string, after: string, reason: string) => {
    const before = files.get(path);
    if (before?.state === 'text' && before.content === after) return;
    changes.push({ path, action: before?.state === 'text' ? 'modify' : 'create', before: before?.state === 'text' ? before.content : null, after, reason });
  };
  const old = document.records.findIndex(({ entry: item }) => item.kind === entry.kind && item.id === entry.id);
  if (entry.kind === 'page' && old >= 0 && project.files.some(({ path }) => path === pageFiles[2])
    && describeDesign(project, files, schema).entries.find(({ entry: item }) => item.kind === 'page' && item.id === entry.id)?.state !== 'planned'
    && JSON.stringify(document.records[old]?.entry) !== JSON.stringify(entry)) {
    issues.push('The published page is locked. Edit its source in VS Code.');
    return result;
  }
  if (entry.kind === 'api' && document.records.some(({ entry: item }) => item.kind === 'api'
    && item.id !== entry.id && item.method === entry.method && item.path === entry.path)) {
    issues.push('Another API design already uses this method and path.');
    return result;
  }
  if (old >= 0) document.records[old] = { entry, references };
  else document.records.push({ entry, references });
  if (!isDesignDocument(document) || Buffer.byteLength(pretty(document)) > 95_000) {
    issues.push('This worktree has reached the supported design document limit.');
    return result;
  }
  write(DESIGN_PATH, pretty(document), 'Save the reviewed design and observed artifact references.');
  if (!mutation.generate || entry.kind !== 'page') return result;
  const occupied = pageFiles.some((path) => files.get(path)?.state !== 'absent');
  const baseline = planProject(project.config, project.projectId).files.find(({ path }) => path === vite);
  const config = files.get(vite);
  if (project.config.stack === GO_STACK || !project.config.library?.template || project.config.modules.some(({ id }) => id === 'authentication')
    || !baseline || config?.state !== 'text' || config.sha256 !== baseline.sha256
    || !project.files.some(({ path, sha256: digest }) => path === vite && digest === baseline.sha256) || occupied) {
    issues.push('Page publication requires a Node Business Workspace without authentication, an unchanged Vite configuration, and vacant page paths.');
    return result;
  }
  const designApi = document.records.find(({ entry: item }) => item.kind === 'api' && item.id === entry.api)?.entry;
  const endpoint = generated.find((api) => api.method === 'GET' && api.auth === 'none'
    && (api.id === entry.api || (designApi?.kind === 'api' && designApi.method === api.method && designApi.path === api.path && designApi.source === api.source)));
  const listEndpoint = endpoint?.path.startsWith('/api/crud/') && !endpoint.path.endsWith('/record');
  if ((entry.api && !endpoint) || (entry.layout === 'table' && (!listEndpoint || !entry.columns.length))) {
    issues.push('Select an implemented public GET endpoint. Table layouts require generated CRUD and at least one column.');
    return result;
  }
  const html = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>Studio page</title></head><body><div id="root"></div><script type="module" src="/features/StudioPage.tsx"></script></body></html>\n';
  const originalVite = `  return {
    root: 'web',
    plugins: [react()],
    build: { outDir: resolve('dist/web'), emptyOutDir: true },`;
  if (!config.content.includes(originalVite)) { issues.push('The pinned Vite entry could not be identified.'); return result; }
  // A Windows cwd can use an 8.3 alias while Vite resolves HTML to its long path.
  // Derive the root, output and both HTML inputs from the same native identity.
  const pageVite = `  const webRoot = realpathSync.native(resolve('web'));
  return {
    root: webRoot,
    plugins: [react()],
    build: {
      outDir: resolve(webRoot, '../dist/web'),
      emptyOutDir: true,
      rolldownOptions: { input: { main: resolve(webRoot, 'index.html'), studio: resolve(webRoot, 'studio-page.html') } },
    },`;
  const nextVite = "import { realpathSync } from 'node:fs';\n" + config.content.replace(originalVite, pageVite);
  write(vite, nextVite, 'Add a second entry point to the exact pinned Vite configuration.');
  write(pageFiles[0], html, 'Create the standalone browser entry at /studio-page.html.');
  write(pageFiles[1], renderPage(entry, endpoint), 'Build the selected React layout using the project’s Business Workspace branding.');
  write(pageFiles[2], '# Studio page: ' + entry.id + '\n\nOpen [/studio-page.html](/studio-page.html) in the running application.\n'
    + (endpoint ? '\nSource endpoint: `GET ' + endpoint.path + '`.\n' : ''), 'Document the actual page and data source.');
  const source = files.get(manifestPath);
  if (source?.state !== 'text') { issues.push('The portable generation manifest is unavailable.'); return result; }
  const manifest: unknown = JSON.parse(source.content);
  if (!isRecord(manifest)) { issues.push('The portable generation manifest is invalid.'); return result; }
  const owned = new Map(project.files.map((item) => [item.path, item]));
  for (const { path, after } of changes) {
    if (path !== DESIGN_PATH && after !== null) owned.set(path, { path, sha256: sha256(after), owner: project.config.stack, action: 'create' });
  }
  if (owned.size > GENERATOR_LIMITS.files) { issues.push('The new page exceeds the portable ownership limit.'); return result; }
  write(manifestPath, pretty({ ...manifest, files: [...owned.values()] }), 'Record exact page source fingerprints in the existing ownership manifest.');
  return result;
}
