import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

const { fetch } = globalThis;
export const fixtureIdentity = {
  email: 'administrator@fixture.invalid',
  password: 'fixture-only-' + randomUUID(),
};

const readerEmail = 'reader@fixture.invalid';
const rotatedReaderPassword = 'rotated-fixture-' + randomUUID();

export async function verifyIdentity(url, client, namespace, full) {
  const origin = url;
  let cookie;
  async function call(method, path, expected, body, headers = {}) {
    const result = await fetch(url + '/api' + path, {
      method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(result.status, expected, method + ' ' + path);
    return { headers: result.headers, data: (await result.json()).data };
  }
  await call('GET', '/auth/session', 401);
  await call('GET', '/crud/products', 401);
  await call('POST', '/auth/login', 403, fixtureIdentity, { Origin: 'https://other.invalid' });
  await call('POST', '/auth/login', 401, { ...fixtureIdentity, password: 'wrong-fixture-password' });
  const signed = await call('POST', '/auth/login', 200, fixtureIdentity);
  const setCookie = signed.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly; SameSite=Strict/u);
  cookie = setCookie.split(';')[0];
  const administratorCookie = cookie;
  const admin = (await call('GET', '/auth/session', 200)).data;
  assert.equal(admin.administrator, true);
  const sessionRow = (await client.query('SELECT token_hash FROM ' + namespace + '.factory_identity_sessions WHERE user_id = $1', [admin.id])).rows[0];
  assert.match(sessionRow.token_hash, /^[a-f0-9]{64}$/u);
  assert.notEqual(sessionRow.token_hash, cookie.split('=')[1]);
  await call('GET', '/crud/products', 200);
  if (full) {
    const password = 'user-temporary-' + randomUUID();
    const account = { email: readerEmail, displayName: 'Record reader', password };
    await call('POST', '/users', 400, { ...account, administrator: true });
    const user = (await call('POST', '/users', 201, account)).data;
    assert.equal(Object.hasOwn(user, 'password_hash'), false);
    await call('POST', '/roles', 400, { name: 'Escalator', permissions: ['roles.manage'] });
    const role = (await call('POST', '/roles', 201, { name: 'Reviewer', permissions: ['crud.read', 'users.manage'] })).data;
    await call('PUT', '/roles/assignments/' + user.id, 200, { roles: [role.id] });
    const category = (await call('POST', '/crud/categories', 201, { id: 44, name: 'Protected tools' })).data;
    assert.equal(category.name, 'Protected tools');
    cookie = undefined;
    const reader = await call('POST', '/auth/login', 200, { email: account.email, password });
    cookie = reader.headers.get('set-cookie').split(';')[0];
    const userCookie = cookie;
    assert.equal((await call('GET', '/auth/session', 200)).data.administrator, false);
    await call('GET', '/crud/categories', 200);
    await call('POST', '/crud/categories', 403, { id: 45, name: 'Unauthorized writing' });
    await call('GET', '/users?q=reader', 200);
    await call('PATCH', '/users/' + admin.id, 403, { password });
    await call('PUT', '/roles/assignments/' + user.id, 403, { roles: [role.id] });
    await call('GET', '/audit', 403);
    cookie = administratorCookie;
    await call('PATCH', '/roles/' + role.id, 200, { name: 'Editor', permissions: ['crud.read', 'crud.write'] });
    cookie = userCookie;
    const product = (await call('POST', '/crud/products', 201, { id: 44, sku: 'PRIVATE-44', name: 'Protected hammer', category_id: 44 })).data;
    assert.equal(product.name, 'Protected hammer');
    await call('PATCH', '/crud/products/record?id=44', 200, { name: 'Updated hammer' });
    await call('DELETE', '/crud/products/record?id=44', 200);
    cookie = administratorCookie;
    await call('PATCH', '/users/' + user.id, 200, { active: false, password: rotatedReaderPassword });
    cookie = userCookie;
    await call('GET', '/auth/session', 401);
    cookie = administratorCookie;
    let audit;
    for (let attempt = 0; attempt < 12; attempt++) {
      audit = (await call('GET', '/audit', 200)).data.rows;
      if (audit.some(({ action }) => action === 'crud.delete')) break;
      await sleep(100);
    }
    const actions = new Set(audit.map(({ action }) => action));
    for (const action of ['auth.login', 'auth.login_failed', 'users.create', 'roles.create', 'roles.assign', 'users.password_rotated', 'crud.delete']) {
      assert(actions.has(action), 'Missing event ' + action);
    }
    assert(audit.some(({ action, resource }) => action === 'crud.delete' && resource === 'products'));
    const auditText = JSON.stringify(audit);
    for (const sensitive of [fixtureIdentity.password, password, rotatedReaderPassword, 'PRIVATE-44', cookie.split('=')[1]]) {
      assert(!auditText.includes(sensitive));
    }
    await call('PATCH', '/roles/' + role.id, 200, { name: 'Editor', permissions: ['crud.read', 'users.manage'] });
    await call('PATCH', '/users/' + user.id, 200, { active: true });
    cookie = undefined;
    await call('POST', '/auth/login', 401, { email: readerEmail, password });
    cookie = administratorCookie;
  }
  const logout = await call('POST', '/auth/logout', 200);
  assert.match(logout.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/u);
  await call('GET', '/auth/session', 401);
  cookie = undefined;
  const next = await call('POST', '/auth/login', 200, fixtureIdentity);
  cookie = next.headers.get('set-cookie').split(';')[0];
  await client.query('UPDATE ' + namespace + ".factory_identity_sessions SET expires_at = NOW() - INTERVAL '1 second' WHERE user_id = $1", [admin.id]);
  await call('GET', '/auth/session', 401);
  cookie = undefined;
  for (let attempt = 0; attempt < 9; attempt++) {
    await call('POST', '/auth/login', attempt < 8 ? 401 : 429, { email: 'unknown@fixture.invalid', password: fixtureIdentity.password });
  }
}

export async function identityBrowser(page, full, mark) {
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Inventory Portal' }).count(), 0);
  const shell = page.locator('.business-workspace');
  assert.equal(await shell.locator('.business-mark').textContent(), mark);
  await page.getByRole('textbox', { name: 'Email' }).fill(fixtureIdentity.email);
  await page.getByLabel('Password', { exact: true }).fill(fixtureIdentity.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Inventory Portal' }).waitFor();
  if (full) {
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await page.getByRole('cell', { name: 'reader@fixture.invalid' }).waitFor();
    await page.getByRole('button', { name: 'Roles', exact: true }).click();
    await page.getByRole('cell', { name: 'Editor' }).waitFor();
    await page.getByRole('button', { name: 'Audit log', exact: true }).click();
    await page.getByRole('cell', { name: 'roles.assign', exact: true }).waitFor();
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  if (full) {
    await page.getByRole('textbox', { name: 'Email' }).fill(readerEmail);
    await page.getByLabel('Password', { exact: true }).fill(rotatedReaderPassword);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Inventory Portal' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Roles', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'New Record', exact: true }).isEnabled(), false);
    await page.getByRole('button', { name: 'Users', exact: true }).click();
    await page.getByRole('cell', { name: readerEmail }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'New user', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Sign in', exact: true }).waitFor();
  }
}

export async function verifySecureCookie(url, origin) {
  assert.equal((await fetch(url + '/api/auth/session')).status, 503);
  const result = await fetch(url + '/api/auth/login', {
    method: 'POST', headers: { Origin: origin, 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '192.0.2.14',
      'Content-Type': 'application/json' }, body: JSON.stringify(fixtureIdentity),
  });
  assert.equal(result.status, 200);
  const cookie = result.headers.get('set-cookie');
  assert.match(cookie, /^__Host-factory_session=/u);
  assert.match(cookie, /Path=\//u);
  assert.match(cookie, /HttpOnly; Secure; SameSite=Strict/u);
}
