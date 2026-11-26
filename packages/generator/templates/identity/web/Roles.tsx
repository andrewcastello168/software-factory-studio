import { useState } from 'react';
import { request } from './client.ts';
import type { PageData } from './client.ts';
import { Grid, useAction, usePage } from './Management.tsx';

interface Role { id: string; name: string; permissions: string[] }
const permissions = @@IDENTITYPERMISSIONSLIST@@;

export function Roles() {
  const page = usePage<Role>('/roles');
  const action = useAction(page.refresh);
  const [selected, setSelected] = useState<Role | null>();
  const [user, setUser] = useState('');
  const [assignments, setAssignments] = useState<string[]>();
  const [available, setAvailable] = useState<Role[]>([]);
  return <section className="identity-admin"><h1>Roles and permissions</h1>
    <button onClick={() => setSelected(null)}>New role</button>
    {selected !== undefined && <form key={selected?.id ?? 'new'} className="identity-form" onSubmit={(event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const input = { name: values.get('name'), permissions: values.getAll('permission') };
      void action.run(() => request(selected ? '/roles/' + selected.id : '/roles', selected ? 'PATCH' : 'POST', input))
        .then((saved) => { if (saved) setSelected(undefined); });
    }}>
      <label>Role name<input name="name" defaultValue={selected?.name} maxLength={100} required /></label>
      <fieldset><legend>Permissions</legend>{permissions.map((permission) => <label key={permission}>
        <input name="permission" type="checkbox" value={permission} defaultChecked={selected?.permissions.includes(permission)} /> {permission}
      </label>)}</fieldset>
      <div><button type="button" onClick={() => setSelected(undefined)}>Cancel</button><button disabled={action.busy}>Save role</button></div>
    </form>}
    <h2>Assign roles</h2>
    <p>Use the user ID shown in the Users workspace.</p>
    <form className="identity-form" onSubmit={(event) => {
      event.preventDefault();
      if (assignments) {
        void action.run(() => request('/roles/assignments/' + encodeURIComponent(user), 'PUT', { roles: assignments }))
          .then((saved) => { if (saved) setAssignments(undefined); });
      } else void action.run(async () => {
        const [existing, roles] = await Promise.all([
          request<string[]>('/roles/assignments/' + encodeURIComponent(user)),
          request<PageData<Role>>('/roles'),
        ]);
        setAvailable(roles.rows); setAssignments(existing);
      });
    }}>
      <label>User ID<input value={user} maxLength={36} required onChange={(event) => { setUser(event.target.value); setAssignments(undefined); }} /></label>
      {assignments && <fieldset><legend>Available roles</legend>{available.map((role) => <label key={role.id}>
        <input type="checkbox" checked={assignments.includes(role.id)} onChange={(event) => setAssignments(event.target.checked
          ? [...assignments, role.id] : assignments.filter((id) => id !== role.id))} /> {role.name}</label>)}</fieldset>}
      <button disabled={action.busy}>{assignments ? 'Save assignments' : 'Load assignments'}</button>
    </form>
    {action.error && <p role="alert">{action.error}</p>}
    {page.error && <p role="alert">{page.error}</p>}
    {page.controls}
    {page.loading ? <p role="status">Loading roles…</p> : <Grid headers={['Name', 'Permissions', 'Manage']}
      rows={page.rows.map((role) => ({ id: role.id, cells: [role.name, role.permissions.join(', '), <button onClick={() => setSelected(role)}>Edit</button>] }))} />}
  </section>;
}
