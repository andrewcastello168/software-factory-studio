import { Code2, ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  AppWindow, ArrowUpRight, ChevronDown, ChevronRight, Clock3, File, Folder, FolderOpen, FolderSearch,
  Link2, RefreshCw, X,
} from 'lucide-react';
import type { OpenProject, ProjectAvailability, ProjectEntry, RecentProject } from '@factory/contracts';
import { Button, IconButton } from './Controls';

const availabilityLabel: Record<ProjectAvailability, string> = {
  ready: 'Available', missing: 'Folder not found', unavailable: 'Folder unavailable', changed: 'Folder changed',
};

export type ProjectView = 'overview' | 'structure' | 'git' | 'database' | 'generation' | 'developer' | 'delivery';

export function WorkspaceTabs({
  projects, active, onSelect, onClose,
}: {
  projects: OpenProject[];
  active: string | null;
  onSelect: (id: string | null) => void;
  onClose: (id: string) => void;
}) {
  const ids = [null, ...projects.map(({ id }) => id)];

  function navigate(event: KeyboardEvent<HTMLButtonElement>, id: string | null) {
    const current = ids.indexOf(id);
    let index: number;
    switch (event.key) {
      case 'ArrowLeft': index = (current - 1 + ids.length) % ids.length; break;
      case 'ArrowRight': index = (current + 1) % ids.length; break;
      case 'Home': index = 0; break;
      case 'End': index = ids.length - 1; break;
      case 'Delete':
        if (id) {
          event.preventDefault();
          onClose(id);
        }
        return;
      default: return;
    }
    event.preventDefault();
    const next = ids[index] ?? null;
    onSelect(next);
    document.getElementById(`workspace-tab-${next ?? 'global'}`)?.focus();
  }

  return (
    <div className="workspace-tabs-bar">
      <div className="workspace-tabs" role="tablist" aria-label="Workspace tabs">
        {ids.map((id, index) => {
          const project = index === 0 ? undefined : projects[index - 1];
          const Icon = project ? Folder : AppWindow;
          return (
            <div key={id ?? 'global'} className="workspace-tab" data-selected={id === active} role="presentation">
              <button
                type="button"
                role="tab"
                id={`workspace-tab-${id ?? 'global'}`}
                aria-selected={id === active}
                aria-controls={id === active ? 'workspace-panel' : undefined}
                tabIndex={id === active ? 0 : -1}
                title={project?.directory}
                onClick={() => onSelect(id)}
                onKeyDown={(event) => navigate(event, id)}
              ><Icon size={15} aria-hidden="true" /><bdi>{project?.name ?? 'Workspace'}</bdi></button>
              {id && project && (
                <IconButton label={`Close ${project.name}`} tabIndex={-1} onClick={() => onClose(id)}>
                  <X size={14} aria-hidden="true" />
                </IconButton>
              )}
            </div>
          );
        })}
      </div>
      {!projects.length && <span className="workspace-scope">Global workspace</span>}
    </div>
  );
}

export function ProjectList({
  title, rows, native, opening, openFolder, open, locate, remove,
}: {
  title: 'Projects' | 'Recent Projects';
  rows: RecentProject[];
  native: boolean;
  opening: boolean;
  openFolder: () => void;
  open: (id: string) => void;
  locate?: (id: string) => void;
  remove?: (id: string) => void;
}) {
  const recent = title === 'Recent Projects';
  const EmptyIcon = recent ? Clock3 : FolderOpen;
  return (
    <div className="page">
      <header className="page-header project-heading">
        <div>
          <h1>{title}</h1>
          <p>{recent ? 'Reopen a folder or locate a project that moved.' : 'Switch between open project folders.'}</p>
        </div>
        {native && <Button variant="primary" onClick={openFolder} disabled={opening}>
          <FolderOpen size={16} aria-hidden="true" />Open Folder
        </Button>}
      </header>
      {!rows.length ? (
        <div className="project-empty">
          <span className="empty-icon"><EmptyIcon size={20} aria-hidden="true" /></span>
          <div>
            <h2>{recent ? 'No recent projects' : 'No open projects'}</h2>
            <p>{native ? 'Open a project folder to get started.' : 'Local folders are available in the desktop app.'}</p>
          </div>
        </div>
      ) : (
        <ul className="project-list" aria-label={title}>
          {rows.map((row) => (
            <li key={row.id} className="project-list-row">
              <Folder size={18} className="project-icon" aria-hidden="true" />
              <div className="project-row-info">
                <bdi className="project-name">{row.name}</bdi>
                <bdi className="project-path" title={row.directory}>{row.directory}</bdi>
              </div>
              <span className={`project-state ${row.availability !== 'ready' ? 'project-state--warning' : ''}`}>
                {availabilityLabel[row.availability]}
              </span>
              <div className="project-row-actions">
                {row.availability === 'ready' || !locate ? (
                  <Button className="outlined-button" aria-label={`Open ${row.name}`} disabled={opening} onClick={() => open(row.id)}>
                    Open<ArrowUpRight size={14} aria-hidden="true" />
                  </Button>
                ) : (
                  <Button className="outlined-button" aria-label={`Locate ${row.name}`} disabled={opening} onClick={() => locate(row.id)}>
                    <FolderSearch size={15} aria-hidden="true" />Locate
                  </Button>
                )}
                {remove && <IconButton label={`Remove ${row.name} from recents`} onClick={() => remove(row.id)}>
                  <X size={15} aria-hidden="true" />
                </IconButton>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface TreeNode {
  entry: ProjectEntry;
  name: string;
  children: TreeNode[];
}

function buildTree(entries: ProjectEntry[]): TreeNode[] {
  const directories = new Map<string, TreeNode>();
  const root: TreeNode[] = [];
  for (const entry of entries) {
    const separator = entry.path.lastIndexOf('/');
    const name = entry.path.slice(separator + 1);
    const node = { entry, name, children: [] };
    const siblings = separator === -1 ? root : directories.get(entry.path.slice(0, separator))?.children;
    siblings?.push(node);
    if (entry.kind === 'directory') directories.set(entry.path, node);
  }
  return root;
}

function TreeItems({
  nodes, expanded, toggle, sourceAction, level = 0,
}: {
  nodes: TreeNode[];
  expanded: Set<string>;
  toggle: (path: string) => void;
  sourceAction?: ((path: string, action: 'editor' | 'reveal') => void) | undefined;
  level?: number;
}) {
  return (
    <ul className="structure-list">
      {nodes.map(({ entry, name, children }) => {
        const isExpanded = expanded.has(entry.path);
        const Icon = entry.kind === 'link' ? Link2 : File;
        return (
          <li key={entry.path}>
            {entry.kind === 'directory' ? (
              <Button
                className="structure-row"
                aria-expanded={isExpanded}
                title={entry.path}
                onClick={() => toggle(entry.path)}
                style={{ paddingInlineStart: 10 + level * 17 }}
              >
                {isExpanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                {isExpanded ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}
                <bdi>{name}</bdi>
              </Button>
            ) : (
              <div className="structure-row" title={entry.path} style={{ paddingInlineStart: 32 + level * 17 }}>
                <Icon size={15} aria-hidden="true" /><bdi>{name}</bdi>
                {entry.kind === 'link' && <span className="structure-note">Link skipped</span>}
                {sourceAction && entry.kind === 'file' && <>
                  <Button className="dev-source-action" aria-label={'Open ' + entry.path + ' in VS Code'} onClick={() => sourceAction(entry.path, 'editor')}><Code2 size={14} /></Button>
                  <Button className="dev-source-action" aria-label={'Reveal ' + entry.path} onClick={() => sourceAction(entry.path, 'reveal')}><ExternalLink size={14} /></Button>
                </>}
                {entry.kind === 'file' && entry.size !== null && <span className="structure-note">{entry.size.toLocaleString('en')} B</span>}
              </div>
            )}
            {entry.kind === 'directory' && isExpanded && (children.length
              ? <TreeItems nodes={children} expanded={expanded} toggle={toggle} sourceAction={sourceAction} level={level + 1} />
              : <p className="structure-note structure-empty" style={{ paddingInlineStart: 32 + (level + 1) * 17 }}>No listed entries</p>)}
          </li>
        );
      })}
    </ul>
  );
}

const metadataLabel = {
  absent: 'No portable descriptor',
  invalid: 'Invalid descriptor',
  unsupported: 'Unsupported descriptor version',
  blocked: 'Descriptor could not be read safely',
  managed: 'Managed project',
};

export function ProjectPanel({
  project, view, setView, rescan, locate, opening, gitContext, sourceAction,
}: {
  project: OpenProject;
  view: 'overview' | 'structure';
  setView: (view: ProjectView) => void;
  sourceAction?: ((path: string, action: 'editor' | 'reveal') => void) | undefined;
  gitContext: string;
  rescan: () => void;
  locate: (() => void) | undefined;
  opening: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildTree(project.entries), [project.entries]);
  const counts = useMemo(() => ({
    files: project.entries.filter((entry) => entry.kind === 'file').length,
    folders: project.entries.filter((entry) => entry.kind === 'directory').length,
  }), [project.entries]);

  function toggle(path: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const descriptor = project.metadata.status === 'managed' ? project.metadata.descriptor : null;
  const title = view === 'overview' ? 'Project Overview' : 'Project Structure';
  return (
    <div className="page project-page">
      <header className="page-header project-heading">
        <div>
          <h1>{title}</h1>
          <p className="project-path"><bdi>{project.directory}</bdi></p>
        </div>
        <div className="project-toolbar" role="group" aria-label="Project actions">
          <Button className="outlined-button" onClick={rescan} disabled={project.refreshing || opening}>
            <RefreshCw size={15} aria-hidden="true" />{project.refreshing ? 'Scanning…' : 'Rescan'}
          </Button>
          {view === 'overview' && project.availability === 'ready' && (
            <Button className="outlined-button" onClick={() => setView('structure')}><Folder size={15} aria-hidden="true" />Browse files</Button>
          )}
        </div>
      </header>
      {project.availability !== 'ready' && (
        <div className="notice project-notice" role="status">
          <FolderSearch size={16} aria-hidden="true" />
          <div><strong>{availabilityLabel[project.availability]}</strong><p>Locate the project or rescan after restoring access.</p></div>
          {locate && <Button onClick={locate} disabled={opening}>Locate Folder</Button>}
        </div>
      )}
      {project.availability === 'ready' && project.partial && (
        <p className="scan-notice" role="status">Some entries were skipped or the scan limit was reached.</p>
      )}
      {project.availability === 'ready' && (view === 'overview' ? (
        <>
          <section className="project-section" aria-labelledby="workspace-details">
            <h2 id="workspace-details"><bdi>{project.name}</bdi></h2>
            <dl className="project-details">
              <div><dt>Folder access</dt><dd>Read-only</dd></div>
              <div><dt>Listed files</dt><dd>{counts.files}</dd></div>
              <div><dt>Listed folders</dt><dd>{counts.folders}</dd></div>
              <div><dt>Git branch and status</dt><dd><bdi>{gitContext}</bdi></dd></div>
            </dl>
          </section>
          <section className="project-section" aria-labelledby="metadata-title">
            <h2 id="metadata-title">Portable metadata</h2>
            <dl className="project-details">
              <div><dt>Status</dt><dd>{metadataLabel[project.metadata.status]}</dd></div>
              {descriptor && (
                <>
                  <div><dt>Project ID</dt><dd className="project-mono">{descriptor.id}</dd></div>
                  {descriptor.type && <div><dt>Type</dt><dd><bdi>{descriptor.type}</bdi></dd></div>}
                  {descriptor.stackId && <div><dt>Stack</dt><dd><bdi>{descriptor.stackId}</bdi></dd></div>}
                  {descriptor.profileId && <div><dt>Profile</dt><dd><bdi>{descriptor.profileId}</bdi></dd></div>}
                </>
              )}
            </dl>
          </section>
        </>
      ) : (
        <section className="structure" aria-label="Project files">
          {tree.length ? <TreeItems nodes={tree} expanded={expanded} toggle={toggle} sourceAction={sourceAction} />
            : <p className="structure-empty">No entries to show in this folder.</p>}
        </section>
      ))}
    </div>
  );
}
