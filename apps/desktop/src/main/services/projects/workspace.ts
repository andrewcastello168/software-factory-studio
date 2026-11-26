import { randomUUID } from 'node:crypto';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { basename } from 'node:path';
import { failure, PROJECT_LIMITS, success } from '@factory/contracts';
import type {
  OpenProject, ProjectAvailability, ProjectCatalog, ProjectMetadata, ProjectSelection, RecentProject, Result,
} from '@factory/contracts';
import { admitRoot, checkedDirectory, pathError, pathKey, sameDirectory } from './filesystem';
import type { ProjectRoot } from './filesystem';
import { isExcludedProjectEntry, readProjectMetadata, scanProject } from './scan';
import type { ProjectScan } from './scan';
import { RecentStore } from './recents';
import type { RecentReference } from './recents';

interface ProjectTab {
  root: ProjectRoot;
  snapshot: OpenProject;
  watchers: Map<string, { close: () => void; identity: ProjectRoot['identity'] }>;
  timer: ReturnType<typeof setTimeout> | null;
  scan: Promise<void> | null;
  manual: Promise<void> | null;
  dirty: boolean;
}

interface ProjectDialogs {
  choose(defaultPath?: string): Promise<string | null>;
  confirmReplacement(previous: RecentReference, candidate: ProjectRoot): Promise<boolean>;
}

const REFRESH_INTERVAL = 12_000;
const DEBOUNCE = 300;

const portableId = (metadata: ProjectMetadata) => metadata.status === 'managed' ? metadata.descriptor.id : null;
const projectName = (root: ProjectRoot, metadata: ProjectMetadata) =>
  (metadata.status === 'managed' && metadata.descriptor.name) || basename(root.path) || root.path.slice(0, 255);

export class ProjectWorkspace {
  #tabs = new Map<string, ProjectTab>();
  #references: RecentReference[] = [];
  #recents: RecentProject[] = [];
  #status: ProjectCatalog['recentsStatus'] = 'ready';
  #revision = 0;
  #closed = false;
  #choosing = false;
  #refreshingRecents: { references: RecentReference[]; request: Promise<void> } | null = null;
  #queue: Promise<unknown> = Promise.resolve();
  #initialized: Promise<void>;
  #heartbeat: ReturnType<typeof setInterval>;

  constructor(
    private readonly store: RecentStore,
    private readonly dialogs: ProjectDialogs,
    private readonly notify: (catalog: ProjectCatalog) => void,
  ) {
    this.#initialized = this.store.load().then(async (references) => {
      if (!references) {
        this.#status = 'unreadable';
      } else {
        this.#references = references;
        await this.#refreshRecents();
      }
    });
    this.#heartbeat = setInterval(() => { void this.reconcile(); }, REFRESH_INTERVAL);
  }

  #catalog(): ProjectCatalog {
    return {
      revision: this.#revision,
      projects: [...this.#tabs.values()].map((tab) => tab.snapshot),
      recents: this.#recents,
      recentsStatus: this.#status,
    };
  }

  #emit() {
    if (!this.#closed) {
      this.#revision++;
      this.notify(this.#catalog());
    }
  }

  #mutate<T>(job: () => Promise<Result<T>>): Promise<Result<T>> {
    const next = this.#queue.then(async () => {
      await this.#initialized;
      return this.#closed ? failure('ACCESS_DENIED') : job();
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async list(): Promise<Result<ProjectCatalog>> {
    await this.#initialized;
    return success(this.#catalog());
  }

  #selection(projectId: string | null): Result<ProjectSelection> {
    return success({ projectId, catalog: this.#catalog() });
  }

  async #adopt(root: ProjectRoot, scan: ProjectScan, prior?: RecentReference, replacePrior = false): Promise<Result<ProjectSelection>> {
    if (this.#closed) return failure('ACCESS_DENIED');
    try {
      await checkedDirectory(root.path, root.identity);
    } catch {
      return failure('PROJECT_UNAVAILABLE');
    }
    if (this.#closed) return failure('ACCESS_DENIED');
    const samePath = [...this.#tabs.values()].find((tab) => pathKey(tab.root.path) === pathKey(root.path));
    const existing = samePath && sameDirectory(samePath.root.identity, root.identity) ? samePath : undefined;
    const record = prior ?? this.#references.find((reference) => pathKey(reference.directory) === pathKey(root.path));
    const replaceTab = (samePath !== existing ? samePath : undefined) ?? (replacePrior && prior
      ? [...this.#tabs.values()].find((tab) => tab.snapshot.recentId === prior.id) : undefined);
    if (!existing && !replaceTab && this.#tabs.size >= PROJECT_LIMITS.tabs) return failure('PROJECT_LIMIT');
    const recent: RecentReference = {
      id: record?.id ?? randomUUID(),
      name: projectName(root, scan.metadata),
      directory: root.path,
      identity: root.identity,
      projectId: portableId(scan.metadata),
    };
    const id = existing?.snapshot.id ?? randomUUID();
    if (replaceTab && replaceTab !== existing) {
      this.#stopWatching(replaceTab);
      this.#tabs.delete(replaceTab.snapshot.id);
    }
    const snapshot: OpenProject = {
      id,
      recentId: recent.id,
      name: recent.name,
      directory: recent.directory,
      availability: 'ready',
      metadata: scan.metadata,
      entries: scan.entries,
      partial: scan.partial,
      refreshing: false,
    };
    if (existing?.scan) {
      existing.snapshot = { ...existing.snapshot, name: recent.name, recentId: recent.id };
    } else {
      const tab: ProjectTab = existing ?? {
        root, snapshot, watchers: new Map(), timer: null, scan: null, manual: null, dirty: false,
      };
      tab.snapshot = snapshot;
      this.#tabs.set(id, tab);
      this.#watch(tab, scan.watched);
    }
    this.#references = [recent, ...this.#references.filter((row) =>
      row.id !== recent.id && pathKey(row.directory) !== pathKey(recent.directory))].slice(0, PROJECT_LIMITS.recents);
    await this.#persist();
    await this.#refreshRecents();
    this.#emit();
    return this.#selection(id);
  }

  #choose(prior?: RecentReference): Promise<Result<ProjectSelection>> {
    if (this.#choosing) return Promise.resolve(failure('PROJECT_BUSY'));
    this.#choosing = true;
    return this.#mutate(async () => {
      try {
        if (prior && !this.#references.includes(prior)) return failure('RECENT_NOT_FOUND');
        const path = await this.dialogs.choose(prior?.directory);
        if (!path || this.#closed) return this.#selection(null);
        const root = await admitRoot(path);
        const scan = await scanProject(root);
        let replacePrior = false;
        if (prior) {
          const availability = await this.#availability(prior);
          replacePrior = availability !== 'ready';
          const sameRoot = sameDirectory(prior.identity, root.identity);
          const samePortable = prior.projectId !== null && prior.projectId === portableId(scan.metadata);
          const moved = availability !== 'ready' && (samePortable || (sameRoot && prior.projectId === null));
          const unchanged = pathKey(root.path) === pathKey(prior.directory) && availability === 'ready';
          if (!moved && !unchanged && !await this.dialogs.confirmReplacement(prior, root)) return this.#selection(null);
          // The chooser and any confirmation apply to the same root and descriptor.
          const current = await readProjectMetadata(root);
          if (portableId(current) !== portableId(scan.metadata)) return failure('PROJECT_UNAVAILABLE');
        }
        return this.#adopt(root, scan, prior, replacePrior);
      } catch {
        return failure('PROJECT_UNAVAILABLE');
      }
    }).finally(() => { this.#choosing = false; });
  }

  root(id: string): ProjectRoot | undefined {
    const tab = this.#tabs.get(id);
    return !this.#closed && tab?.snapshot.availability === 'ready' ? tab.root : undefined;
  }

  canOpen(): boolean {
    return !this.#closed && this.#tabs.size < PROJECT_LIMITS.tabs;
  }

  adoptCloned(root: ProjectRoot): Promise<Result<ProjectSelection>> {
    return this.#mutate(async () => {
      try {
        return await this.#adopt(root, await scanProject(root));
      } catch {
        return failure('PROJECT_UNAVAILABLE');
      }
    });
  }

  openFolder(): Promise<Result<ProjectSelection>> {
    return this.#choose();
  }

  async locateRecent(id: string): Promise<Result<ProjectSelection>> {
    await this.#initialized;
    const recent = this.#references.find((reference) => reference.id === id);
    return recent ? this.#choose(recent) : failure('RECENT_NOT_FOUND');
  }

  openRecent(id: string): Promise<Result<ProjectSelection>> {
    return this.#mutate(async () => {
      const record = this.#references.find((reference) => reference.id === id);
      if (!record) return failure('RECENT_NOT_FOUND');
      try {
        const root = await admitRoot(record.directory);
        if (pathKey(root.path) === pathKey(record.directory) && sameDirectory(root.identity, record.identity)) {
          const scan = await scanProject(root);
          if (record.projectId === null || record.projectId === portableId(scan.metadata)) {
            return this.#adopt(root, scan, record);
          }
        }
      } catch {
        // The recent remains available for Locate even when its path cannot be read.
      }
      await this.#refreshRecents();
      this.#emit();
      return failure('PROJECT_UNAVAILABLE');
    });
  }

  removeRecent(id: string): Promise<Result<ProjectCatalog>> {
    return this.#mutate(async () => {
      if (!this.#references.some((row) => row.id === id)) return failure('RECENT_NOT_FOUND');
      this.#references = this.#references.filter((row) => row.id !== id);
      await this.#persist();
      await this.#refreshRecents();
      this.#emit();
      return success(this.#catalog());
    });
  }

  async #persist() {
    if (this.#status === 'unreadable') return;
    // A user can admit their home or drive root. Keep that scan read-only even
    // when the application's own recent store is inside the selected folder.
    for (const tab of this.#tabs.values()) {
      if (await this.store.isInside(tab.root.path)) {
        this.#status = 'unsaved';
        return;
      }
    }
    this.#status = await this.store.save(this.#references) ? 'ready' : 'unsaved';
  }

  async #availability(record: RecentReference): Promise<ProjectAvailability> {
    try {
      const root = await admitRoot(record.directory);
      if (pathKey(root.path) !== pathKey(record.directory) || !sameDirectory(root.identity, record.identity)) return 'changed';
      if (record.projectId && record.projectId !== portableId(await readProjectMetadata(root))) return 'changed';
      return 'ready';
    } catch (error) {
      return pathError(error);
    }
  }

  #refreshRecents(): Promise<void> {
    const references = this.#references;
    const pending = this.#refreshingRecents;
    if (pending) {
      return pending.references === references ? pending.request : pending.request.then(() => this.#refreshRecents());
    }
    const request = Promise.all(references.map(async (record): Promise<RecentProject> => ({
      id: record.id, name: record.name, directory: record.directory, availability: await this.#availability(record),
    }))).then((recent) => {
      if (!this.#closed && references === this.#references && JSON.stringify(recent) !== JSON.stringify(this.#recents)) {
        this.#recents = recent;
        this.#emit();
      }
    }).finally(() => { this.#refreshingRecents = null; });
    this.#refreshingRecents = { references, request };
    return request;
  }

  #schedule(tab: ProjectTab) {
    if (this.#closed || this.#tabs.get(tab.snapshot.id) !== tab || tab.timer) return;
    tab.timer = setTimeout(() => {
      tab.timer = null;
      void this.#scan(tab);
    }, DEBOUNCE);
  }

  #watch(tab: ProjectTab, directories: ProjectScan['watched']) {
    // Watching individual descendants on Windows can prevent moving their
    // parent directory. One native recursive watch keeps only the root open.
    const recursive = process.platform === 'win32';
    const watched = recursive ? directories.slice(0, 1) : directories;
    const known = new Map(watched.map((entry) => [entry.path, entry.identity]));
    for (const [path, watcher] of tab.watchers) {
      const identity = known.get(path);
      if (identity && sameDirectory(identity, watcher.identity)) {
        known.delete(path);
        continue;
      }
      watcher.close();
      tab.watchers.delete(path);
    }
    for (const [path, identity] of known) {
      let watcher: FSWatcher;
      try {
        // Event names only filter noise. They never enter a filesystem call.
        watcher = watch(path, { persistent: false, recursive }, (_event, name) => {
          if (!name || !name.split(/[\\/]/u).some(isExcludedProjectEntry)) this.#schedule(tab);
        });
      } catch {
        continue;
      }
      const registration = { close: () => watcher.close(), identity };
      watcher.on('error', () => {
        watcher.close();
        if (tab.watchers.get(path) !== registration) return;
        tab.watchers.delete(path);
        this.#schedule(tab);
      });
      tab.watchers.set(path, registration);
    }
  }

  #stopWatching(tab: ProjectTab) {
    for (const watcher of tab.watchers.values()) watcher.close();
    tab.watchers.clear();
    if (tab.timer) clearTimeout(tab.timer);
    tab.timer = null;
  }

  #scan(tab: ProjectTab, manual = false): Promise<void> {
    if (this.#closed || this.#tabs.get(tab.snapshot.id) !== tab) return Promise.resolve();
    if (manual && !tab.snapshot.refreshing) {
      tab.snapshot = { ...tab.snapshot, refreshing: true };
      this.#emit();
    }
    if (tab.scan) {
      tab.dirty = true;
      return tab.scan;
    }
    tab.scan = scanProject(tab.root).then((scan) => {
      if (this.#closed || this.#tabs.get(tab.snapshot.id) !== tab) return;
      const next: OpenProject = {
        ...tab.snapshot, availability: 'ready', name: projectName(tab.root, scan.metadata),
        metadata: scan.metadata, entries: scan.entries, partial: scan.partial, refreshing: false,
      };
      this.#watch(tab, scan.watched);
      if (JSON.stringify(next) !== JSON.stringify(tab.snapshot)) {
        tab.snapshot = next;
        this.#emit();
      }
    }).catch(async (error: unknown) => {
      if (this.#closed || this.#tabs.get(tab.snapshot.id) !== tab) return;
      this.#stopWatching(tab);
      const next: OpenProject = {
        ...tab.snapshot, availability: pathError(error), entries: [], metadata: { status: 'absent' },
        partial: false, refreshing: false,
      };
      if (JSON.stringify(next) !== JSON.stringify(tab.snapshot)) {
        tab.snapshot = next;
        await this.#refreshRecents();
        this.#emit();
      }
    }).finally(() => {
      tab.scan = null;
      if (tab.dirty) {
        tab.dirty = false;
        this.#schedule(tab);
      }
    });
    return tab.scan;
  }

  async rescan(id: string): Promise<Result<ProjectCatalog>> {
    const tab = this.#tabs.get(id);
    if (!tab) return failure('ACCESS_DENIED');
    tab.manual ??= this.#manualScan(tab).finally(() => { tab.manual = null; });
    await tab.manual;
    return this.#tabs.get(id) === tab ? success(this.#catalog()) : failure('ACCESS_DENIED');
  }

  async #manualScan(tab: ProjectTab) {
    // Finish a watcher scan that started before the manual request.
    await tab.scan;
    if (this.#tabs.get(tab.snapshot.id) !== tab) return;
    if (tab.timer) clearTimeout(tab.timer);
    tab.timer = null;
    await this.#scan(tab, true);
    await this.#refreshRecents();
  }

  async reconcile() {
    await this.#initialized;
    if (this.#closed) return;
    for (const tab of this.#tabs.values()) this.#schedule(tab);
    await this.#refreshRecents();
  }

  close(id: string): Promise<Result<ProjectCatalog>> {
    return this.#mutate(async () => {
      const tab = this.#tabs.get(id);
      if (!tab) return failure('ACCESS_DENIED');
      this.#stopWatching(tab);
      this.#tabs.delete(id);
      this.#emit();
      return success(this.#catalog());
    });
  }

  dispose() {
    this.#closed = true;
    for (const tab of this.#tabs.values()) this.#stopWatching(tab);
    this.#tabs.clear();
    clearInterval(this.#heartbeat);
  }
}
