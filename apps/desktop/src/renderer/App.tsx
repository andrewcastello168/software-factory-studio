import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AlertCircle, AppWindow, CircleCheck, Folder, GitBranch, House, LoaderCircle, PanelLeft,
  PanelLeftClose, PanelLeftOpen, Settings2,
} from 'lucide-react';
import { SIDEBAR } from '@factory/contracts';
import { browserPreview, usePreferences } from './usePreferences';
import { Button, Dialog, IconButton } from './components/Controls';
import { CommandPalette, WorkspaceMenu } from './components/Commands';
import type { Command } from './components/Commands';
import { Navigation } from './components/Navigation';
import type { Page } from './components/Navigation';
import { Home, OpenCommandButton, Settings } from './components/Pages';

const clamp = (value: number) => Math.round(Math.max(SIDEBAR.minimum, Math.min(SIDEBAR.maximum, value)));

export function App() {
  const state = usePreferences();
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
        if (!restore) openPalette();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [mac, openPalette, restore]);

  const commands: Command[] = [
    { id: 'home', title: 'Home', icon: House, run: () => setPage('home') },
    { id: 'settings', title: 'Settings', icon: Settings2, run: () => setPage('settings') },
    { id: 'sidebar', title: 'Toggle Sidebar', icon: PanelLeft, run: toggleSidebar },
  ];

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
          <span className="project-context"><Folder size={15} aria-hidden="true" />No project open</span>
          <span className="context-detail" title="Working directory: None"><span>Directory</span><span aria-label="Working directory: None">—</span></span>
          <span className="context-detail" title="Git branch: None"><GitBranch size={14} aria-hidden="true" /><span aria-label="Git branch: None">—</span></span>
          <span className="context-detail" title="Working tree: Unavailable"><span>Working tree</span><span aria-label="Working tree: Unavailable">—</span></span>
        </div>
        <OpenCommandButton open={openPalette} shortcut={shortcut} />
      </header>

      <div className={`workbench ${collapsed ? 'workbench--collapsed' : ''}`} style={{ '--sidebar-width': `${selectedWidth}px` } as CSSProperties}>
        {!collapsed && (
          <>
            <aside className="sidebar">
              <div className="sidebar-heading"><span>Explorer</span><WorkspaceMenu commands={commands} /></div>
              <Navigation page={page} onSelect={setPage} />
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
          <div className="workspace-tabs" aria-label="Workspace tabs">
            <div className="workspace-tab" aria-current="true"><AppWindow size={15} aria-hidden="true" />Workspace</div>
            <span className="workspace-scope">Global workspace</span>
          </div>
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
            {page === 'home'
              ? <Home openSettings={() => setPage('settings')} openPalette={openPalette} />
              : <Settings
                  theme={state.preferences.theme}
                  onTheme={(theme) => void state.write({ action: 'update', changes: { theme } })}
                  disabled={!state.editable}
                  loading={state.loading}
                  browser={browserPreview}
                  sidebarWidth={selectedWidth}
                  sidebarOpen={!collapsed}
                  toggleSidebar={toggleSidebar}
                />}
          </main>
        </div>
      </div>
      <footer className="statusbar">
        <span><AppWindow size={13} aria-hidden="true" />{browserPreview ? 'Browser development' : 'Desktop workspace'}</span>
        <div>
          <span role="status" className={notice ? 'status-warning' : undefined}><StatusIcon size={13} aria-hidden="true" />{status}</span>
          {state.appInfo && <span aria-label={`Studio version ${state.appInfo.version}`}>v{state.appInfo.version}</span>}
        </div>
      </footer>
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
