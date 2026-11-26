import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { BUSINESS_TEMPLATE, isLibraryAsset, STANDARD_PROFILE } from '@factory/contracts';
import type { EngineeringProfile } from '@factory/contracts';
import { LibraryStore } from './library';

it('publishes immutable profile and template versions and rejects stale or untrusted edits', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-library-'));
  try {
    const store = new LibraryStore(root);
    const profile: EngineeringProfile = {
      ...STANDARD_PROFILE, id: '1a60740d-c9c7-4c39-a56b-8df3b8eec710', name: 'Client Engineering',
      advice: { Testing: 'Use isolated database fixtures.' },
    };
    expect(await store.publish(STANDARD_PROFILE)).toEqual({ ok: false, error: 'LIBRARY_CONFLICT' });
    expect(await store.publish(profile)).toEqual({ ok: true, value: profile });
    expect(await store.publish({ ...profile, advice: { Testing: 'Test API responses before release.' } })).toMatchObject({ ok: true, value: { version: 2 } });
    expect(await store.publish(profile)).toEqual({ ok: false, error: 'LIBRARY_CONFLICT' });
    const layout = { ...BUSINESS_TEMPLATE, id: '210536a1-43d0-44a0-8cc0-5cae5afe32d3', name: 'Client theme', mark: 'CL' };
    expect(await store.publish(layout)).toEqual({ ok: true, value: layout });
    const reloaded = await new LibraryStore(root).list();
    expect(reloaded.ok && reloaded.value.find(({ id, version }) => id === profile.id && version === 1)).toEqual(profile);
    for (const input of [{ ...profile, advice: { Testing: 'token=sample-secret' } }, { ...profile, advice: { Testing: 'https://example.invalid' } },
      { ...profile, path: '../outside' }, { ...layout, color: 'url(file://outside)' }]) expect(isLibraryAsset(input)).toBe(false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('fails closed when the personal library file is a symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'studio-library-'));
  try {
    const destination = join(root, 'outside.json');
    await writeFile(destination, '{}');
    await symlink(destination, join(root, 'engineering-library.json'));
    expect(await new LibraryStore(root).list()).toEqual({ ok: false, error: 'LIBRARY_CONFLICT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
