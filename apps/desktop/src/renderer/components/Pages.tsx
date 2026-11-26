import { ArrowUpRight, Command, FolderOpen, GitFork, Monitor, Moon, PanelLeft, Search, Settings2, Sun } from 'lucide-react';
import type { Theme } from '@factory/contracts';
import { Button } from './Controls';

export function Home({
  openSettings, openPalette, openFolder, openProjects, native, opening, projectCount, cloneRepository,
}: {
  openSettings: () => void;
  openPalette: () => void;
  openFolder: () => void;
  cloneRepository?: (() => void) | undefined;
  openProjects: () => void;
  native: boolean;
  opening: boolean;
  projectCount: number;
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
              <p>{native ? 'Open an existing folder or clone a Git repository.' : 'Local folders are available in the desktop app.'}</p>
              {native && <div className="home-project-actions">
                <Button variant="primary" onClick={openFolder} disabled={opening}>Open Folder</Button>
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
    </div>
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
