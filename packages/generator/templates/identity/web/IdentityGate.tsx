import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { allowed, request, RequestError } from './client.ts';
import type { Actor } from './client.ts';
import './identity.css';
@@IDENTITYWEBIMPORTS@@
const access = { rbac: @@IDENTITYRBAC@@ };
const account = createContext<Actor | null>(null);
export function RecordAccess({ children }: { children: (canWrite: boolean) => ReactNode }) {
  const actor = useContext(account);
  if (!actor || (access.rbac && !allowed(actor, 'crud.read'))) return <p>Record access is unavailable for this account.</p>;
  return children(!access.rbac || allowed(actor, 'crud.write'));
}

export function IdentityGate({ children }: { children: ReactNode }) {
  const [actor, setActor] = useState<Actor | null>();
  const [view, setView] = useState('workspace');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { setActor(await request<Actor>('/auth/session', 'GET', undefined, signal)); }
    catch (cause) {
      if (signal?.aborted) return;
      setActor(null);
      if (!(cause instanceof RequestError) || cause.status !== 401) setError('Sign-in service is unavailable.');
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const id = setInterval(() => void refresh(controller.signal), 60_000);
    return () => { clearInterval(id); controller.abort(); };
  }, [refresh]);
  async function signin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setError(''); setBusy(true);
    try {
      await request('/auth/login', 'POST', { email: values.get('email'), password: values.get('password') });
      setView('workspace');
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Sign-in failed.'); }
    finally { form.reset(); setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try { await request('/auth/logout', 'POST'); setActor(null); setView('workspace'); }
    catch { setError('Could not sign out. Try again.'); }
    finally { setBusy(false); }
  }
  if (actor === undefined) return <p role="status">Checking session…</p>;
  if (!actor) return <section className="identity-login" aria-labelledby="identity-login-title">
    <h1 id="identity-login-title">Sign in</h1>
    {error && <p role="alert">{error}</p>}
    <form className="identity-form" onSubmit={(event) => void signin(event)}>
      <label>Email<input name="email" type="email" autoComplete="username" required maxLength={254} /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required maxLength={256} /></label>
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </section>;
  const pages = [{ id: 'workspace', label: 'Workspace', content: children }];
@@IDENTITYPAGES@@
  const selected = pages.find(({ id }) => id === view) ?? pages[0]!;
  return <account.Provider value={actor}>
    <header className="identity-bar">
      <nav aria-label="Account workspace">{pages.map((page) => <button key={page.id} aria-pressed={page.id === selected.id}
        onClick={() => setView(page.id)}>{page.label}</button>)}</nav>
      <span>{actor.display_name}</span><button disabled={busy} onClick={() => void logout()}>Sign out</button>
    </header>
    {error && <p role="alert">{error}</p>}
    {selected.content}
  </account.Provider>;
}
