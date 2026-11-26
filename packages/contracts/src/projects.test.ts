import { describe, expect, it } from 'vitest';
import { isProjectCatalog, isProjectId, isProjectSegment } from './projects';

describe('project IPC validation', () => {
  it.each(['.', '..', 'foo/bar', 'foo\\bar', 'file:stream', 'CON.txt', 'COM¹', 'name.', ' trailing ', 'bad\u0000name'])(
    'refuses the unsafe workspace segment %s',
    (segment) => { expect(isProjectSegment(segment)).toBe(false); },
  );

  it('accepts opaque project tokens and ordinary Unicode names only in their respective positions', () => {
    expect(isProjectId('/tmp/workspace')).toBe(false);
    expect(isProjectId('02b192a8-b874-4423-9add-af527064998f')).toBe(true);
    expect(isProjectSegment('project café.txt')).toBe(true);
    expect(isProjectCatalog({ revision: 0, projects: [], recents: [], recentsStatus: 'ready', extra: true })).toBe(false);
  });
});
