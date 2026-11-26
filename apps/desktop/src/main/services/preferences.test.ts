import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultPreferences, failure, success } from '@factory/contracts';
import { PreferenceStore } from './preferences';

let directory: string;
let file: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'factory-preferences-'));
  file = join(directory, 'preferences.json');
});
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

describe('local preference storage', () => {
  it('retains both fields across serialized writes and a fresh store', async () => {
    const store = new PreferenceStore(file);
    expect(await store.read()).toEqual(success({ storage: 'ready', preferences: defaultPreferences }));
    const first = store.write({ action: 'update', changes: { theme: 'dark' } });
    const second = store.write({ action: 'update', changes: { sidebarWidth: 300 } });
    expect(await first).toEqual(success({ theme: 'dark', sidebarWidth: 240 }));
    expect(await second).toEqual(success({ theme: 'dark', sidebarWidth: 300 }));
    expect(await new PreferenceStore(file).read()).toEqual(success({
      storage: 'ready', preferences: { theme: 'dark', sidebarWidth: 300 },
    }));
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
      version: 1, preferences: { theme: 'dark', sidebarWidth: 300 },
    });
  });

  it('uses defaults and requires explicit repair of corrupt settings', async () => {
    await writeFile(file, '{invalid');
    const store = new PreferenceStore(file);
    expect(await store.read()).toEqual(success({ storage: 'corrupt', preferences: defaultPreferences }));
    expect(await store.write({ action: 'update', changes: { theme: 'light' } }))
      .toEqual(failure('PREFERENCES_REVIEW_REQUIRED'));
    expect(await readFile(file, 'utf8')).toBe('{invalid');
    expect(await store.write({ action: 'restoreDefaults' })).toEqual(success(defaultPreferences));
    expect(await store.read()).toEqual(success({ storage: 'ready', preferences: defaultPreferences }));
  });

  it('preserves unknown future versions, including on a repair request', async () => {
    const contents = '{"version":2,"preferences":{"theme":"custom"}}';
    await writeFile(file, contents);
    const store = new PreferenceStore(file);
    expect(await store.read()).toEqual(success({ storage: 'unsupported', preferences: defaultPreferences }));
    expect(await store.write({ action: 'restoreDefaults' })).toEqual(failure('PREFERENCES_REVIEW_REQUIRED'));
    expect(await readFile(file, 'utf8')).toBe(contents);
  });

  it('reports a read failure and leaves an unexpected directory in place', async () => {
    await mkdir(file);
    const store = new PreferenceStore(file);
    expect(await store.read()).toEqual(failure('PREFERENCES_READ_FAILED'));
    expect(await store.write({ action: 'update', changes: { theme: 'dark' } })).toEqual(failure('PREFERENCES_READ_FAILED'));
  });

  it('fails safely when a temporary filename exceeds the filesystem limit', async () => {
    const badFile = join(directory, 'missing', 'x'.repeat(250));
    const store = new PreferenceStore(badFile);
    expect(await store.read()).toEqual(success({ storage: 'ready', preferences: defaultPreferences }));
    expect(await store.write({ action: 'update', changes: { theme: 'dark' } })).toEqual(failure('PREFERENCES_WRITE_FAILED'));
    expect(await store.read()).toEqual(success({ storage: 'ready', preferences: defaultPreferences }));
  });
});
