import { useEffect, useState } from 'react';
import type { ErrorCode, ProjectCatalog, ProjectSelection, Result } from '@factory/contracts';
import { browserPreview } from './usePreferences';

const bridge = browserPreview ? undefined : window.studio?.projects;
const initial: ProjectCatalog = { revision: -1, projects: [], recents: [], recentsStatus: 'ready' };
const messages: Partial<Record<ErrorCode, string>> = {
  PROJECT_UNAVAILABLE: 'Studio could not open that folder. If it moved, locate it in Recent Projects.',
  PROJECT_LIMIT: 'Close a project tab before opening another folder.',
  PROJECT_BUSY: 'A folder chooser is already open.',
  RECENT_NOT_FOUND: 'This project is no longer in Recent Projects.',
  ACCESS_DENIED: 'This project is no longer available in this window.',
};

export function useProjects() {
  const [catalog, setCatalog] = useState(initial);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (next: ProjectCatalog) => setCatalog((current) => next.revision >= current.revision ? next : current);

  useEffect(() => {
    if (!bridge) return;
    let live = true;
    const stop = bridge.onChange(update);
    void bridge.list().then((result) => {
      if (!live) return;
      if (result.ok) update(result.value);
      else setError(messages[result.error] ?? 'Studio could not load the project workspace.');
    }).catch(() => {
      if (live) setError('Studio could not load the project workspace.');
    });
    return () => { live = false; stop(); };
  }, []);

  async function invoke<T>(action: () => Promise<Result<T>>): Promise<T | null> {
    setError(null);
    try {
      const result = await action();
      if (result.ok) return result.value;
      setError(messages[result.error] ?? 'Studio could not complete the project action.');
    } catch {
      setError('Studio could not complete the project action.');
    }
    return null;
  }

  async function select(action: () => Promise<Result<ProjectSelection>>) {
    setOpening(true);
    try {
      const selection = await invoke(action);
      if (selection) update(selection.catalog);
      return selection?.projectId ?? null;
    } finally {
      setOpening(false);
    }
  }

  async function change(action: () => Promise<Result<ProjectCatalog>>) {
    const result = await invoke(action);
    if (result) update(result);
    return result;
  }

  return {
    catalog,
    applySelection: (selection: ProjectSelection) => update(selection.catalog),
    error,
    opening,
    native: Boolean(bridge),
    dismiss: () => setError(null),
    openFolder: () => bridge && select(() => bridge.openFolder()),
    openRecent: (id: string) => bridge && select(() => bridge.openRecent(id)),
    locate: (id: string) => bridge && select(() => bridge.locateRecent(id)),
    remove: (id: string) => bridge && change(() => bridge.removeRecent(id)),
    rescan: (id: string) => bridge && change(() => bridge.rescan(id)),
    close: (id: string) => bridge && change(() => bridge.close(id)),
  };
}
