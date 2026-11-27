import { DeliveryWorkspace, deliveryBridge } from './components/Delivery';
import { FileCheck2 } from 'lucide-react';
import { DeveloperWorkspace, developerBridge, developerErrors } from './components/Developer';
import { Code2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AlertCircle, AppWindow, CircleCheck, Clock3, Database, Folder, FolderOpen, FolderPlus, GitBranch, GitFork, House, ListChecks, LoaderCircle, PanelLeft, RefreshCw, X,
  PanelLeftClose, PanelLeftOpen, Settings2,
} from 'lucide-react';
import { SIDEBAR } from '@factory/contracts';
import type { GitCloneRequest } from '@factory/contracts';
import { browserPreview, usePreferences } from './usePreferences';
import { Button, Dialog, IconButton } from './components/Controls';
import { CommandPalette, WorkspaceMenu } from './components/Commands';
import type { Command } from './components/Commands';
import { useProjects } from './useProjects';
import { gitBridge, gitLabel, useGit } from './useGit';
import { CloneDialog, GitPanel } from './components/Git';
import { DatabasePanel, schemaBridge, supportsDatabaseStudio } from './components/schema/DatabaseStudio';
import { GenerationReview, incrementalBridge } from './components/GenerationReview';
import { GeneratorDialog, generatorBridge } from './components/Generator';
import { ProjectList, ProjectPanel, WorkspaceTabs } from './components/Projects';
import type { ProjectView } from './components/Projects';
import { Navigation } from './components/Navigation';
import type { Page } from './components/Navigation';
import { EngineeringLibrary, isLibraryPage, libraryBridge, libraryPages, libraryTitles } from './components/EngineeringLibrary';
import { Home, OpenCommandButton, Settings } from './components/Pages';

const clamp = (value: number) => Math.round(Math.max(SIDEBAR.minimum, Math.min(SIDEBAR.maximum, value)));

export function App() {
  const state = usePreferences();
  const workspace = useProjects();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [views, setViews] = useState<Record<string, ProjectView>>({});
  const activeProject = workspace.catalog.projects.find((project) => project.id === activeId);
  const active = activeProject?.id ?? null;
  const git = useGit(activeProject);
  const repo = git.status?.state === 'repository' ? git.status : null;
  const [cloning, setCloning] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [generatorView, setGeneratorView] = useState<'new' | 'recovery' | null>(null);
  const [linkedTable, setLinkedTable] = useState<{ projectId: string; name: string }>();
  const [handoffError, setHandoffError] = useState('');
  const [cloneNotice, setCloneNotice] = useState<string | null>(null);
  const view = activeProject ? views[activeProject.id] ?? 'overview' : null;
  const database = Boolean(schemaBridge && supportsDatabaseStudio(activeProject));
  const generation = Boolean(incrementalBridge && supportsDatabaseStudio(activeProject));
  const [page, setPage] = useState<Page>('home');
  const [collapsed, setCollapsed] = useState(false);
  const [palette, setPalette] = useState(false);
  const [restore, setRestore] = useState(false);
  const [draftWidth, setDraftWidth] = useState<number>();
  const drag = useRef<{ origin: number; width: number } | null>(null);
  const widthRevision = useRef(0);
  const selectedWidth = draftWidth ?? state.preferences.sidebarWidth;
  const mac = state.appInfo ? state.appInfo.platform === 'darwin' : /Mac/.test(navigator.userAgent);
  const shortcut = mac ? '⌘ K' : 'Ctrl K';
  const openPalette = useCallback(() => setPalette(true), []);

  function toggleSidebar() {
    setCollapsed((visible) => !visible);
  }

  function updateWidth(width: number) {
    if (width === state.preferences.sidebarWidth && draftWidth === undefined) return;
    const revision = ++widthRevision.current;
    setDraftWidth(width);
    void state.write({ action: 'update', changes: { sidebarWidth: width } }).finally(() => {
      if (revision === widthRevision.current) setDraftWidth(undefined);
    });
  }

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if ((mac ? event.metaKey : event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!restore && !cloneOpen && !document.querySelector('dialog[open]')) openPalette();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [mac, openPalette, restore, cloneOpen]);

  function openSource(projectId: string, path: string, action: 'editor' | 'reveal') {
    setHandoffError('');
    void developerBridge?.handoff({ projectId, action, path, line: null, column: null }).then((result) => {
      if (!result.ok) setHandoffError(developerErrors[result.error] ?? 'The selected source could not be opened.');
    });
  }

  function openPage(next: Page) {
    setActiveId(null);
    setPage(next);
  }

  async function selectProject(result: Promise<string | null> | undefined) {
    const id = await result;
    if (id) setActiveId(id);
  }

  function openFolder() {
    void selectProject(workspace.openFolder());
  }

  async function clone(input: GitCloneRequest) {
    if (cloning || !gitBridge) return;
    setCloning(true);
    setCloneNotice(null);
    try {
      const response = await gitBridge.clone(input);
      if (response?.ok) {
        const { selection, level, message } = response.value;
        if (selection) {
          workspace.applySelection(selection);
          const id = selection.projectId;
          if (id) {
            setActiveId(id);
            setViews((current) => ({ ...current, [id]: 'git' }));
          }
        }
        if (level === 'error' || level === 'warning') setCloneNotice(message);
      } else {
        setCloneNotice('Studio could not start the clone operation.');
      }
    } catch {
      setCloneNotice('Studio could not reach the desktop Git service.');
    } finally {
      setCloning(false);
      setCloneOpen(false);
    }
  }

  function openProjectView(next: ProjectView) {
    if (active) setViews((current) => ({ ...current, [active]: next }));
  }

  async function closeProject(id: string) {
    const index = workspace.catalog.projects.findIndex((project) => project.id === id);
    const catalog = await workspace.close(id);
    if (!catalog) return;
    setViews((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    if (active === id) {
      const next = catalog.projects[index]?.id ?? catalog.projects[index - 1]?.id ?? null;
      setActiveId(next);
      document.getElementById(`workspace-tab-${next ?? 'global'}`)?.focus();
    }
  }

  const commands: Command[] = [
    { id: 'home', title: 'Home', icon: House, run: () => openPage('home') },
    { id: 'settings', title: 'Settings', icon: Settings2, run: () => openPage('settings') },
    { id: 'projects', title: 'Projects', icon: Folder, run: () => openPage('projects') },
    { id: 'recents', title: 'Recent Projects', icon: Clock3, run: () => openPage('recents') },
    { id: 'sidebar', title: 'Toggle Sidebar', icon: PanelLeft, run: toggleSidebar },
  ];

  if (workspace.native && !workspace.opening) {
    commands.splice(1, 0, { id: 'open-folder', title: 'Open Folder', icon: FolderOpen, run: openFolder });
  }
  if (gitBridge && !cloning && !workspace.opening) {
    commands.splice(2, 0, { id: 'clone', title: 'Clone Repository', icon: GitFork, run: () => setCloneOpen(true) });
  }
  if (generatorBridge && !workspace.opening) {
    commands.splice(1, 0, { id: 'new-project', title: 'New Project', icon: FolderPlus, run: () => setGeneratorView('new') });
    commands.push({ id: 'generation-recovery', title: 'Generation Recovery', icon: RefreshCw, run: () => setGeneratorView('recovery') });
  }
  if (activeProject) {
    commands.push(
      { id: 'overview', title: 'Project Overview', icon: House, run: () => openProjectView('overview') },
      { id: 'structure', title: 'Project Structure', icon: Folder, run: () => openProjectView('structure') },
      { id: 'git', title: 'Git Studio', icon: GitBranch, run: () => openProjectView('git') },
      ...(deliveryBridge ? [{ id: 'delivery', title: 'Client Delivery', icon: FileCheck2, run: () => openProjectView('delivery') }] : []),
      ...(developerBridge ? [{ id: 'developer', title: 'Developer Tools', icon: Code2, run: () => openProjectView('developer') }] : []),
      { id: 'rescan', title: 'Rescan Project', icon: RefreshCw, run: () => { void workspace.rescan(activeProject.id); void git.refresh(); } },
      { id: 'close-project', title: 'Close Project', icon: X, run: () => void closeProject(activeProject.id) },
    );
  }

  if (libraryBridge) for (const destination of libraryPages) {
    commands.push({ id: destination, title: libraryTitles[destination], icon: Settings2, run: () => openPage(destination) });
  }
  if (generation) commands.push({ id: 'generation', title: 'Generation Review', icon: ListChecks, run: () => openProjectView('generation') });
  if (database) commands.push({ id: 'database', title: 'Database Studio', icon: Database, run: () => openProjectView('database') });
  const notice = state.error ?? (state.storage === 'corrupt'
    ? 'Stored preferences are unreadable. Studio is using defaults.'
    : state.storage === 'unsupported'
      ? 'A newer version of Studio saved these preferences. Open that version to edit them.'
      : undefined);
  const status = browserPreview ? 'Desktop preferences unavailable'
    : state.loading ? 'Reading preferences…' : state.saving ? 'Saving preferences…'
      : notice ? 'Preferences need attention' : state.saved ? 'Preferences saved' : 'Preferences ready';
  const StatusIcon = browserPreview ? AppWindow : state.loading || state.saving ? LoaderCircle : notice ? AlertCircle : CircleCheck;

  return (
    <div className="studio">
      <a href="#workspace-main" className="skip-link" onClick={(event) => {
        event.preventDefault();
        document.getElementById('workspace-main')?.focus();
      }}>Skip to workspace content</a>
      <header className="topbar">
        <div className="brand">
          <IconButton
            label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-controls={!collapsed ? 'workspace-navigation' : undefined}
            aria-expanded={!collapsed}
            onClick={toggleSidebar}
          >
            {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
          </IconButton>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span className="brand-name">Factory Studio</span>
        </div>
        <div className="context-bar" role="group" aria-label="Project context">
          <span className="project-context"><Folder size={15} aria-hidden="true" /><bdi>{activeProject?.name ?? 'No project open'}</bdi></span>
          <span className="context-detail context-directory" title={`Working directory: ${activeProject?.directory ?? 'None'}`}>
            <span>Directory</span><bdi>{activeProject?.directory ?? '—'}</bdi>
          </span>
          {activeProject ? <Button className="context-detail context-git" onClick={() => openProjectView('git')}
            title={repo ? `${repo.branch ?? 'Detached HEAD'} · ${gitLabel(repo)} · ${repo.head ?? 'Unborn HEAD'}` : 'Open Git Studio'}>
            <GitBranch size={14} aria-hidden="true" /><bdi>{repo?.branch ?? (repo ? 'Detached HEAD' : gitLabel(git.status))}</bdi>
            {repo && <span className="context-git-status">{gitLabel(repo)}</span>}
          </Button> : <span className="context-detail"><GitBranch size={14} aria-hidden="true" /><span>Git unavailable</span></span>}
        </div>
        <OpenCommandButton open={openPalette} shortcut={shortcut} />
      </header>

      <div className={`workbench ${collapsed ? 'workbench--collapsed' : ''}`} style={{ '--sidebar-width': `${selectedWidth}px` } as CSSProperties}>
        {!collapsed && (
          <>
            <aside className="sidebar">
              <div className="sidebar-heading"><span>Explorer</span><WorkspaceMenu commands={commands} /></div>
              <Navigation page={active ? null : page} onSelect={openPage} projectView={view} onProjectView={openProjectView} database={database} generation={generation} developer={Boolean(developerBridge)} delivery={Boolean(deliveryBridge)} />
            </aside>
            <div
              className="separator"
              role="separator"
              aria-label="Sidebar width"
              aria-controls="workspace-navigation"
              aria-orientation="vertical"
              aria-valuemin={SIDEBAR.minimum}
              aria-valuemax={SIDEBAR.maximum}
              aria-valuenow={selectedWidth}
              aria-valuetext={`${selectedWidth} pixels`}
              aria-disabled={!state.editable}
              tabIndex={0}
              onKeyDown={(event) => {
                const values: Record<string, number> = {
                  ArrowLeft: selectedWidth - SIDEBAR.step, ArrowRight: selectedWidth + SIDEBAR.step,
                  Home: SIDEBAR.minimum, End: SIDEBAR.maximum,
                };
                const value = Object.hasOwn(values, event.key) ? values[event.key] : undefined;
                if (state.editable && value !== undefined) {
                  event.preventDefault();
                  updateWidth(clamp(value));
                }
              }}
              onPointerDown={(event) => {
                if (!state.editable || event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                drag.current = { origin: event.clientX, width: selectedWidth };
              }}
              onPointerMove={(event) => {
                if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
                  setDraftWidth(clamp(drag.current.width + event.clientX - drag.current.origin));
                }
              }}
              onPointerUp={(event) => {
                if (!drag.current) return;
                updateWidth(clamp(drag.current.width + event.clientX - drag.current.origin));
                drag.current = null;
              }}
              onLostPointerCapture={() => {
                if (drag.current) {
                  drag.current = null;
                  setDraftWidth(undefined);
                }
              }}
            />
          </>
        )}
        <div className="workspace">
          {handoffError && <p role="alert" className="notice">{handoffError} <Button onClick={() => setHandoffError('')}>Dismiss</Button></p>}
          <WorkspaceTabs projects={workspace.catalog.projects} active={active} onSelect={setActiveId} onClose={(id) => void closeProject(id)} />
          <main className="workspace-main" id="workspace-main" tabIndex={-1}>
            {notice && (
              <div className="notice-wrap">
                <div className="notice" role="alert">
                  <AlertCircle size={16} aria-hidden="true" />
                  <span>{notice}</span>
                  {state.storage === 'corrupt'
                    ? <Button onClick={() => setRestore(true)} disabled={state.saving}>Restore defaults</Button>
                    : <Button onClick={state.load} disabled={state.loading || state.saving}>Reload preferences</Button>}
                </div>
              </div>
            )}
            {cloneNotice && <div className="notice-wrap"><div className="notice" role="alert">
              <AlertCircle size={16} aria-hidden="true" /><span>{cloneNotice}</span>
              <IconButton label="Dismiss clone result" onClick={() => setCloneNotice(null)}><X size={15} aria-hidden="true" /></IconButton>
            </div></div>}
            {workspace.error && <div className="notice-wrap"><div className="notice" role="alert">
              <AlertCircle size={16} aria-hidden="true" /><span>{workspace.error}</span>
              <IconButton label="Dismiss project error" onClick={workspace.dismiss}><X size={15} aria-hidden="true" /></IconButton>
            </div></div>}
            {workspace.catalog.recentsStatus !== 'ready' && (
              <div className="notice-wrap"><div className="notice" role="status">
                {workspace.catalog.recentsStatus === 'unreadable'
                  ? 'Recent Projects could not be read. The stored list was preserved.'
                  : 'Recent Projects could not be saved. Changes apply to this session.'}
              </div></div>
            )}
            <section role="tabpanel" id="workspace-panel" aria-labelledby={`workspace-tab-${active ?? 'global'}`}>
              {activeProject && view === 'git' ? <GitPanel key={activeProject.id} project={activeProject} git={git} opened={(selection) => {
                  workspace.applySelection(selection);
                  setActiveId(selection.projectId);
                }} />
                : activeProject && view === 'generation' && generation ? <GenerationReview key={activeProject.id} project={activeProject}
                  signal={JSON.stringify([repo?.branch, repo?.head, repo?.operation, repo?.revision,
                    activeProject.entries.filter(({ path }) => path.startsWith('db/migrations/') || path.startsWith('.factory/'))])} />
                : activeProject && view === 'delivery' && deliveryBridge ? <DeliveryWorkspace key={activeProject.id} project={activeProject}
                  signal={JSON.stringify([repo?.revision, activeProject.entries.filter(({ path }) => path !== 'dist' && !path.startsWith('dist/'))
                    .map(({ path, modifiedAt, size }) => [path, modifiedAt, size])])}
                  openSource={(path) => openSource(activeProject.id, path, 'editor')} openRecovery={openProjectView} />
                : activeProject && view === 'developer' && developerBridge ? <DeveloperWorkspace key={activeProject.id}
                  project={activeProject} signal={JSON.stringify([repo?.branch, repo?.head, repo?.revision, activeProject.entries.length])}
                  openTable={(name) => { setLinkedTable({ projectId: activeProject.id, name }); openProjectView('database'); }} />
                : activeProject && view === 'database' && database ? <DatabasePanel key={activeProject.id + (linkedTable?.projectId === activeProject.id ? ':' + linkedTable.name : '')} project={activeProject}
                  initialTable={linkedTable?.projectId === activeProject.id ? linkedTable.name : undefined}
                  sourceSignal={JSON.stringify([repo?.branch, repo?.head, repo?.operation,
                    activeProject.entries.filter(({ path }) => path.startsWith('db/migrations/'))])} />
                : activeProject && view ? <ProjectPanel
                key={activeProject.id}
                project={activeProject}
                sourceAction={developerBridge ? (path, action) => openSource(activeProject.id, path, action) : undefined}
                view={view === 'structure' ? 'structure' : 'overview'}
                setView={openProjectView}
                rescan={() => { void workspace.rescan(activeProject.id); void git.refresh(); }}
                gitContext={repo ? `${repo.branch ?? 'Detached HEAD'} · ${gitLabel(repo)}` : gitLabel(git.status)}
                locate={workspace.catalog.recents.some((recent) => recent.id === activeProject.recentId)
                  ? () => void selectProject(workspace.locate(activeProject.recentId)) : undefined}
                opening={workspace.opening}
              /> : page === 'home'
                ? <Home
                    openSettings={() => openPage('settings')}
                    openPalette={openPalette}
                    openFolder={openFolder}
                    newProject={generatorBridge ? () => setGeneratorView('new') : undefined}
                    cloneRepository={gitBridge ? () => setCloneOpen(true) : undefined}
                    openProjects={() => openPage('recents')}
                    native={workspace.native}
                    opening={workspace.opening}
                    projectCount={workspace.catalog.projects.length}
                  />
                : page === 'settings' ? <Settings
                    theme={state.preferences.theme}
                    onTheme={(theme) => void state.write({ action: 'update', changes: { theme } })}
                    disabled={!state.editable}
                    loading={state.loading}
                    browser={browserPreview}
                    sidebarWidth={selectedWidth}
                    sidebarOpen={!collapsed}
                    toggleSidebar={toggleSidebar}
                  />
                : isLibraryPage(page) ? <EngineeringLibrary key={page} page={page} />
                : page === 'projects' ? <ProjectList
                    title="Projects"
                    rows={workspace.catalog.projects}
                    native={workspace.native}
                    opening={workspace.opening}
                    openFolder={openFolder}
                    open={setActiveId}
                  />
                : <ProjectList
                    title="Recent Projects"
                    rows={workspace.catalog.recents}
                    native={workspace.native}
                    opening={workspace.opening}
                    openFolder={openFolder}
                    open={(id) => void selectProject(workspace.openRecent(id))}
                    locate={(id) => void selectProject(workspace.locate(id))}
                    remove={(id) => void workspace.remove(id)}
                  />}
            </section>
          </main>
        </div>
      </div>
      <footer className="statusbar">
        <span><AppWindow size={13} aria-hidden="true" />{
          browserPreview ? 'Browser development' : cloning ? 'Cloning repository…' : workspace.opening ? 'Opening folder…'
            : activeProject?.refreshing ? 'Scanning project…'
              : activeProject?.availability === 'ready' ? (repo ? 'Git workspace' : 'Local project') : activeProject ? 'Project unavailable' : 'Desktop workspace'
        }</span>
        <div>
          <span role="status" className={notice ? 'status-warning' : undefined}><StatusIcon size={13} aria-hidden="true" />{status}</span>
          {state.appInfo && <span aria-label={`Studio version ${state.appInfo.version}`}>v{state.appInfo.version}</span>}
        </div>
      </footer>
      {generatorView && <GeneratorDialog
        recovery={generatorView === 'recovery'}
        close={() => setGeneratorView(null)}
        opened={(selection) => {
          workspace.applySelection(selection);
          setActiveId(selection.projectId);
        }}
      />}
      {cloneOpen && <CloneDialog close={() => setCloneOpen(false)} clone={(input) => void clone(input)} busy={cloning} />}
      {palette && <CommandPalette commands={commands} close={() => setPalette(false)} />}
      {restore && (
        <Dialog title="Restore default preferences?" onClose={() => setRestore(false)}>
          <p className="confirm-copy">This replaces the unreadable preference file with the default theme and sidebar width.</p>
          <div className="dialog-actions">
            <Button autoFocus onClick={() => setRestore(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => { setRestore(false); void state.write({ action: 'restoreDefaults' }); }}>Restore defaults</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
