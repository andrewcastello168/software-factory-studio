import {
  Blocks, BookOpen, Box, Clock3, Folder, House, Layers3, Library, Package, Settings2, Users, Waypoints,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from './Controls';

export type Page = 'home' | 'settings';
const groups: { title: string; entries: { title: string; icon: LucideIcon; page?: Page }[] }[] = [
  {
    title: 'Workspace',
    entries: [
      { title: 'Home', icon: House, page: 'home' },
      { title: 'Projects', icon: Folder },
      { title: 'Recent Projects', icon: Clock3 },
    ],
  },
  {
    title: 'Factory Library',
    entries: [
      { title: 'Technology Catalog', icon: Library },
      { title: 'Architecture Library', icon: Layers3 },
      { title: 'Template Studio', icon: Blocks },
      { title: 'Module Library', icon: Package },
      { title: 'Component Library', icon: Box },
      { title: 'Plugin Manager', icon: Waypoints },
    ],
  },
  {
    title: 'Organization',
    entries: [
      { title: 'Team Workspace', icon: Users },
      { title: 'Engineering Standards', icon: BookOpen },
      { title: 'Settings', icon: Settings2, page: 'settings' },
    ],
  },
];

export function Navigation({ page, onSelect }: { page: Page; onSelect: (page: Page) => void }) {
  return (
    <nav id="workspace-navigation" className="navigation" aria-label="Global navigation">
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
