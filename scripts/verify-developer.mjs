import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

const { AbortSignal, fetch } = globalThis;

export async function verifyDeveloper(vite, fixture, { DATABASE_URL, PORT }, frontendPort) {
  const { DeveloperStudio } = await vite.ssrLoadModule('/apps/desktop/src/main/services/developer/studio.ts');
  const { admitRoot } = await vite.ssrLoadModule('/apps/desktop/src/main/services/projects/filesystem.ts');
  const root = await admitRoot(fixture);
  const projectId = randomUUID();
  await writeFile(join(fixture, '.env'), 'PORT=' + PORT + '\n' + (DATABASE_URL ? 'DATABASE_URL=' + DATABASE_URL + '\n' : ''), { flag: 'wx', mode: 0o600 });
  const allowed = (path) => !path.startsWith(root.path);
  const approvals = [];
  const studio = new DeveloperStudio({
    root: (id) => id === projectId ? root : undefined,
    allows: allowed,
    git: async () => ({ ok: true, value: { state: 'not-repository', detail: 'Disposable generated project.' } }),
  }, {
    async confirm(title, detail) {
      assert(!DATABASE_URL || !detail.includes(DATABASE_URL), 'A credential appeared in native review.');
      approvals.push(title);
      return true;
    },
    chooseEditor: async () => null, reveal: () => undefined, copy: () => undefined, openURL: async () => undefined,
  });
  async function start(task) {
    const review = await studio.preview({ projectId, task, frontendPort });
    assert(review.ok, task + ' review: ' + JSON.stringify(review));
    const started = await studio.start({ projectId, id: review.value.id });
    assert(started.ok, task + ' start: ' + JSON.stringify(started));
    return started.value.id;
  }

  async function observe(id, condition) {
    for (let attempt = 0; attempt < 640; attempt++) {
      const current = await studio.logs(projectId);
      assert(current.ok);
      const entry = current.value.find(({ process }) => process.id === id);
      if (entry?.process.state === 'failed') throw new Error(JSON.stringify(entry.lines));
      if (entry && condition(entry.process)) return;
      await wait(175);
    }
    const current = await studio.logs(projectId);
    throw new Error('Managed command did not reach the expected state: ' + JSON.stringify(current));
  }

  try {
    for (const task of ['build', 'test']) {
      const id = await start(task);
      await observe(id, ({ state }) => state === 'completed');
    }
    const backendId = await start('backend');
    await observe(backendId, ({ ready }) => ready);
    const frontendId = await start('frontend');
    await observe(frontendId, ({ ready }) => ready);
    const request = (path, method = 'GET', body = '') => studio.request({ projectId, backendId, method, path, query: [], headers: [], body });
    const ready = await request('/api/ready');
    assert(ready.ok && ready.value.status === (DATABASE_URL ? 200 : 503));
    if (DATABASE_URL) {
      const inserted = await request('/api/crud/products', 'POST', JSON.stringify({ id: 54, sku: 'PHASE-10', name: 'Managed runtime', category_id: 1 }));
      assert(inserted.ok && inserted.value.status === 201, 'Managed runtime must create a PostgreSQL record.');
      const records = await request('/api/crud/products');
      assert(records.ok && records.value.status === 200 && records.value.body.includes('Managed runtime'));
    }
    const throughVite = await fetch('http://127.0.0.1:' + frontendPort + '/api/health', { signal: AbortSignal.timeout(5000) });
    assert.equal(throughVite.status, 200);
    for (const id of [frontendId, backendId]) {
      assert.deepEqual(await studio.control({ projectId, id, action: 'stop' }), { ok: true, value: true });
      await observe(id, ({ state }) => state === 'stopped');
    }
    assert.equal(approvals.filter((title) => title === 'Trust and run project code?').length, 4);
    assert.equal(await fetch('http://127.0.0.1:' + PORT + '/api/health', { signal: AbortSignal.timeout(2500) }).catch(() => null), null);
    console.log('Studio reviewed build, test, frontend, backend, local HTTP and process shutdown passed.');
  } finally {
    await studio.dispose();
  }
}
