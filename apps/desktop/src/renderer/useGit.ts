import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitAction, GitState, OpenProject } from '@factory/contracts';
import { browserPreview } from './usePreferences';

export const gitBridge = browserPreview ? undefined : window.studio?.git;

interface Snapshot {
  id: string;
  status: GitState;
}

export function gitLabel(status: GitState | null) {
  if (!status) return 'Checking Git…';
  if (status.state === 'not-repository') return 'No repository';
  if (status.state !== 'repository') return 'Git unavailable';
  if (status.operation) return `${status.operation} in progress`;
  return status.changes.length ? `${status.changes.length} changed` : 'Clean';
}

export function useGit(project: OpenProject | undefined) {
  const id = project?.availability === 'ready' ? project.id : null;
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const clock = useRef<{ sequence: number; active: string | null }>({ sequence: 0, active: null });
  const refresh = useCallback(async () => {
    if (!gitBridge || !id) return;
    const request = ++clock.current.sequence;
    try {
      const result = await gitBridge.status(id);
      if (clock.current.sequence !== request) return;
      setSnapshot({ id, status: result.ok ? result.value : { state: 'missing', detail: 'The current folder is unavailable.' } });
    } catch {
      if (clock.current.sequence === request) setSnapshot({ id, status: { state: 'failed', detail: 'Studio could not refresh Git.' } });
    }
  }, [id]);

  useEffect(() => {
    if (!id || !gitBridge) return;
    const lifecycle = clock.current;
    lifecycle.active = id;
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 5000);
    function onFocus() { void refresh(); }
    window.addEventListener('focus', onFocus);
    return () => {
      lifecycle.sequence++;
      lifecycle.active = null;
      clearInterval(poll);
      window.removeEventListener('focus', onFocus);
    };
  }, [id, refresh]);

  async function action(request: GitAction) {
    const result = await gitBridge?.action(request);
    if (result?.ok && request.id === clock.current.active) {
      clock.current.sequence++;
      setSnapshot({ id: request.id, status: result.value.status });
    }
    return result;
  }

  const status = id && snapshot?.id === id ? snapshot.status : null;
  return { status, refresh, action };
}
