import { useState } from 'react';
import { request } from './client.ts';
import { Grid, useAction, usePage } from './Management.tsx';

interface Account { id: string; email: string; display_name: string; active: boolean; administrator: boolean }

export function Users({ editable }: { editable: boolean }) {
  const page = usePage<Account>('/users');
  const editor = useAction(page.refresh);
  const [selected, setSelected] = useState<Account | null>();
  return <section className="identity-admin"><h1>Users</h1>
    {editable && <button onClick={() => setSelected(null)}>New user</button>}
    {editable && selected !== undefined && <form key={selected?.id ?? 'new'} className="identity-form" onSubmit={(event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const password = String(form.get('password') ?? '');
      const displayName = String(form.get('displayName') ?? '');
      const body = selected ? { displayName, active: form.has('active'), ...(password ? { password } : {}) }
        : { displayName, email: form.get('email'), password };
      void editor.run(() => request(selected ? '/users/' + selected.id : '/users', selected ? 'PATCH' : 'POST', body))
        .then((saved) => { if (saved) setSelected(undefined); });
    }}>
      {!selected && <label>Email<input name="email" type="email" maxLength={254} required /></label>}
      <label>Display name<input name="displayName" defaultValue={selected?.display_name} required maxLength={100} /></label>
      <label>{selected ? 'New password' : 'Initial password'}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={256} required={!selected} /></label>
      {selected && <label><input type="checkbox" name="active" defaultChecked={selected.active} /> Active</label>}
      <div><button type="button" onClick={() => setSelected(undefined)}>Cancel</button><button disabled={editor.busy}>Save user</button></div>
    </form>}
    {editor.error && <p role="alert">{editor.error}</p>}
    {page.error && <p role="alert">{page.error}</p>}
    {page.controls}
    {page.loading ? <p role="status">Loading users…</p> : <Grid headers={['Email', 'Display name', 'User ID', 'Status', 'Manage']}
      rows={page.rows.map((user) => ({ id: user.id, cells: [user.email, user.display_name, user.id, user.active ? 'Active' : 'Inactive',
        user.administrator ? 'Bootstrap administrator' : editable ? <button onClick={() => setSelected(user)}>Edit</button> : 'Read only'] }))} />}
  </section>;
}
