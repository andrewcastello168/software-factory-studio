import { Code2, Database, FileCheck2, ListChecks } from 'lucide-react';
import {
  Blocks, BookOpen, Box, Clock3, Folder, GitBranch, House, Layers3, Library, Package, Settings2, Users, Waypoints,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './Controls';
import { libraryBridge } from './EngineeringLibrary';
import type { LibraryPage } from './EngineeringLibrary';
import type { ProjectView } from './Projects';

export type Page = 'home' | 'projects' | 'recents' | 'settings' | LibraryPage;
const groups: { title: string; entries: { title: string; icon: LucideIcon; page?: Page }[] }[] = [
  {
    title: 'Workspace',
    entries: [
      { title: 'Home', icon: House, page: 'home' },
      { title: 'Projects', icon: Folder, page: 'projects' },
      { title: 'Recent Projects', icon: Clock3, page: 'recents' },
    ],
  },
  {
    title: 'Factory Library',
    entries: [
      { title: 'Technology Catalog', icon: Library, ...(libraryBridge ? { page: 'technology' as const } : {}) },
      { title: 'Architecture Library', icon: Layers3, ...(libraryBridge ? { page: 'architecture' as const } : {}) },
      { title: 'Template Studio', icon: Blocks, ...(libraryBridge ? { page: 'templates' as const } : {}) },
      { title: 'Module Library', icon: Package, ...(libraryBridge ? { page: 'modules' as const } : {}) },
      ...(libraryBridge ? [{ title: 'AI Context', icon: BookOpen, page: 'context' as const }] : []),
      { title: 'Component Library', icon: Box },
      { title: 'Plugin Manager', icon: Waypoints },
    ],
  },
  {
    title: 'Organization',
    entries: [
      { title: 'Team Workspace', icon: Users },
      { title: 'Engineering Standards', icon: BookOpen, ...(libraryBridge ? { page: 'profiles' as const } : {}) },
      { title: 'Settings', icon: Settings2, page: 'settings' },
    ],
  },
];

export function Navigation({
  page, onSelect, projectView, onProjectView, database, generation, developer, delivery,
}: {
  page: Page | null;
  onSelect: (page: Page) => void;
  projectView: ProjectView | null;
  database: boolean;
  generation: boolean;
  developer: boolean;
  delivery: boolean;
  onProjectView: (view: ProjectView) => void;
}) {
  return (
    <nav id="workspace-navigation" className="navigation" aria-label="Global navigation">
      {projectView && (
        <section className="nav-group" aria-label="Active project">
          <h2>Project</h2>
          <ul>
            <li><Button aria-current={projectView === 'overview' ? 'page' : undefined} onClick={() => onProjectView('overview')}>
              <House size={16} aria-hidden="true" />Overview
            </Button></li>
            <li><Button aria-current={projectView === 'structure' ? 'page' : undefined} onClick={() => onProjectView('structure')}>
              <Folder size={16} aria-hidden="true" />Project Structure
            </Button></li>
            <li><Button aria-current={projectView === 'git' ? 'page' : undefined} onClick={() => onProjectView('git')}>
              <GitBranch size={16} aria-hidden="true" />Git Studio
            </Button></li>
            {database && <li><Button aria-current={projectView === 'database' ? 'page' : undefined} onClick={() => onProjectView('database')}>
              <Database size={16} aria-hidden="true" />Database Studio
            </Button></li>}
            {developer && <li><Button aria-current={projectView === 'developer' ? 'page' : undefined} onClick={() => onProjectView('developer')}>
              <Code2 size={16} aria-hidden="true" />Developer Tools
            </Button></li>}
            {delivery && <li><Button aria-current={projectView === 'delivery' ? 'page' : undefined} onClick={() => onProjectView('delivery')}>
              <FileCheck2 size={16} aria-hidden="true" />Client Delivery
            </Button></li>}
            {generation && <li><Button aria-current={projectView === 'generation' ? 'page' : undefined} onClick={() => onProjectView('generation')}>
              <ListChecks size={16} aria-hidden="true" />Generation Review
            </Button></li>}
          </ul>
        </section>
      )}
      {groups.map((group) => (
        <section key={group.title} className="nav-group" aria-label={group.title} data-planned={group.entries.every((entry) => !entry.page)}>
          <h2>{group.title}{group.entries.every((entry) => !entry.page) && <small>Planned</small>}</h2>
          <ul>
            {group.entries.map(({ title, icon: Icon, page: destination }) => (
              <li key={title}>
                {destination
                  ? <Button aria-current={page === destination ? 'page' : undefined} onClick={() => onSelect(destination)}>
                      <Icon size={16} aria-hidden="true" /><span>{title}</span>
                    </Button>
                  : <span className="nav-planned" aria-disabled="true">
                      <Icon size={15} aria-hidden="true" /><span>{title}</span><small>Planned</small>
                    </span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
