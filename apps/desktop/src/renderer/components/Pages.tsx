import { ArrowUpRight, BookOpen, Command, FolderOpen, GitFork, Monitor, Moon, PanelLeft, Search, Settings2, Sun } from 'lucide-react';
import { useState } from 'react';
import { GO_STACK, STACKS } from '@factory/contracts';
import type { Theme, Toolchain } from '@factory/contracts';
import { Button } from './Controls';

export function Home({
  openSettings, openPalette, openFolder, openProjects, native, opening, projectCount, cloneRepository, newProject, openCatalog, openStandards,
}: {
  openSettings: () => void;
  openPalette: () => void;
  openFolder: () => void;
  newProject?: (() => void) | undefined;
  cloneRepository?: (() => void) | undefined;
  openProjects: () => void;
  native: boolean;
  opening: boolean;
  projectCount: number;
  openCatalog?: (() => void) | undefined;
  openStandards?: (() => void) | undefined;
}) {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Home</h1>
        <p>Open a local project or configure your Studio workspace.</p>
      </header>
      <div className="home-grid">
        <section aria-labelledby="projects-title" className="projects">
          <h2 id="projects-title">Projects</h2>
          <div className="project-empty">
            <span className="empty-icon"><FolderOpen size={20} aria-hidden="true" /></span>
            <div>
              <h3>{projectCount ? `${projectCount} open ${projectCount === 1 ? 'project' : 'projects'}` : 'No project open'}</h3>
              <p>{native ? 'Create an application, open a folder, or clone a Git repository.' : 'Local folders are available in the desktop app.'}</p>
              {native && <div className="home-project-actions">
                {newProject && <Button variant="primary" onClick={newProject} disabled={opening}>New Project</Button>}
                <Button variant={newProject ? 'quiet' : 'primary'} onClick={openFolder} disabled={opening}>Open Folder</Button>
                <Button onClick={openProjects}>Recent Projects<ArrowUpRight size={14} aria-hidden="true" /></Button>
              </div>}
            </div>
          </div>
        </section>
        <section aria-labelledby="actions-title" className="quick-actions">
          <h2 id="actions-title">Quick actions</h2>
          <Button onClick={openSettings}>
            <Settings2 size={16} aria-hidden="true" /><span>Open Settings</span><ArrowUpRight size={14} aria-hidden="true" />
          </Button>
          {cloneRepository && <Button onClick={cloneRepository} disabled={opening}>
            <GitFork size={16} aria-hidden="true" /><span>Clone Repository</span><ArrowUpRight size={14} aria-hidden="true" />
          </Button>}
          <Button onClick={openPalette}>
            <Command size={16} aria-hidden="true" /><span>Command palette</span><ArrowUpRight size={14} aria-hidden="true" />
          </Button>
        </section>
      </div>
      {native && <GettingStarted openCatalog={openCatalog} openStandards={openStandards} />}
    </div>
  );
}

function GettingStarted({ openCatalog, openStandards }: {
  openCatalog?: (() => void) | undefined;
  openStandards?: (() => void) | undefined;
}) {
  const [status, setStatus] = useState<'idle' | 'checking' | 'failed'>('idle');
  const [tools, setTools] = useState<Toolchain>();
  const { execution, databaseRuntime } = STACKS[GO_STACK];
  const inspect = window.studio?.inspectToolchain;
  async function check() {
    if (!inspect) return;
    setStatus('checking');
    try {
      const result = await inspect();
      if (!result.ok) throw new Error(result.error);
      setTools(result.value);
      setStatus('idle');
    } catch {
      setTools(undefined);
      setStatus('failed');
    }
  }
  return (
    <details className="home-guide">
      <summary><BookOpen size={16} aria-hidden="true" />Getting started</summary>
      <div className="home-guide-body">
        <p>Studio includes its own runtime. Use New Project to scaffold a client application, or Open Folder to work in an existing directory.</p>
        <p>To run generated projects, install Node.js {execution.node}, pnpm {execution.pnpm} and {databaseRuntime}. Go projects also need Go {execution.go}. Git Studio requires Git 2.39 or later.</p>
        <div className="home-project-actions">
          {openCatalog && <Button onClick={openCatalog}>View technology catalog</Button>}
          {openStandards && <Button onClick={openStandards}>View engineering standards</Button>}
          {inspect && <Button onClick={() => void check()} disabled={status === 'checking'}>Check developer tools</Button>}
        </div>
        {status === 'checking' && <p role="status">Checking installed tools…</p>}
        {status === 'failed' && <p role="alert">Tool discovery failed. Retry or check the tools from your terminal.</p>}
        {tools && <dl className="home-toolchain" aria-label="Detected developer tools" aria-live="polite">
          {Object.entries(tools).map(([name, version]) => <div key={name}><dt>{name}</dt><dd>{version ?? 'Not detected'}</dd></div>)}
        </dl>}
      </div>
    </details>
  );
}

const themes = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'light', label: 'Light', icon: Sun },
] as const;

export function Settings({
  theme, onTheme, disabled, loading, browser, sidebarWidth, sidebarOpen, toggleSidebar,
}: {
  theme: Theme;
  onTheme: (theme: Theme) => void;
  disabled: boolean;
  loading: boolean;
  browser: boolean;
  sidebarWidth: number;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}) {
  return (
    <div className="page">
      <header className="page-header">
        <h1>Settings</h1>
        <p>{browser ? 'Preview appearance for this browser session.' : 'Configure how Studio looks on this device.'}</p>
      </header>
      <section aria-labelledby="appearance-title" aria-busy={loading} className="settings-section">
        <h2 id="appearance-title">Appearance</h2>
        <fieldset className="theme-field" disabled={disabled}>
          <legend>Color theme</legend>
          <p>System follows your operating system’s appearance.</p>
          <div className="theme-options">
            {themes.map(({ value, label, icon: Icon }) => (
              <label key={value}>
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => onTheme(value)}
                />
                <span><Icon size={16} aria-hidden="true" />{label}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      <section aria-labelledby="navigation-title" className="settings-section">
        <h2 id="navigation-title">Navigation</h2>
        <div className="settings-row">
          <div>
            <h3>Sidebar</h3>
            <p>Expanded width <strong className="setting-value">{sidebarWidth} px</strong></p>
          </div>
          <Button
            className="outlined-button"
            aria-controls={sidebarOpen ? 'workspace-navigation' : undefined}
            onClick={toggleSidebar}
          >
            <PanelLeft size={16} aria-hidden="true" />{sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function OpenCommandButton({ open, shortcut }: { open: () => void; shortcut: string }) {
  return (
    <Button className="command-trigger" onClick={open} aria-label="Open command palette">
      <Search size={15} aria-hidden="true" />
      <span>Search commands</span>
      <kbd>{shortcut}</kbd>
    </Button>
  );
}
