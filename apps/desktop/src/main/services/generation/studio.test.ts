import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { STARTER, success } from '@factory/contracts';
import type { GeneratorParent, Result, StarterConfig } from '@factory/contracts';
import { sha256 } from '@factory/generator';
import { GenerationJournal } from './journal';
import type { GenerationRecord } from './journal';
import { GeneratorStudio } from './studio';

const config: StarterConfig = {
  name: 'Client café', slug: 'client-cafe', port: 4150,
  appType: STARTER.appType, stack: STARTER.stack, architecture: STARTER.architecture, engineering: STARTER.engineering,
};

class InterruptedJournal extends GenerationJournal {
  override async save(record: GenerationRecord, initial = false) {
    await super.save(record, initial);
    if (record.createdFiles === 3) throw new Error('Simulated interruption.');
  }
}

let fixture: string;
let parent: string;
let data: string;
let chosen: string;
let approve: () => Promise<boolean>;

function unwrap<T>(result: Result<T>) {
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function service(journal = new GenerationJournal(data)) {
  return new GeneratorStudio(journal, {
    canOpen: () => true,
    adopt: async () => success({ projectId: '33456900-cdd8-4576-8001-239594c4c704',
      catalog: { revision: 0, projects: [], recents: [], recentsStatus: 'ready' } }),
  }, { choose: async () => chosen, confirm: () => approve() });
}

async function review(studio: GeneratorStudio, input = config) {
  const grant = unwrap(await studio.chooseParent()) as GeneratorParent;
  return unwrap(await studio.preview({ parentId: grant.id, config: input }));
}

beforeEach(async () => {
  fixture = await realpath(await mkdtemp(join(tmpdir(), 'factory-generation-')));
  data = join(fixture, 'app-data');
  parent = join(fixture, 'Client Projects café');
  await Promise.all([mkdir(data), mkdir(parent)]);
  chosen = parent;
  approve = async () => true;
});

afterEach(async () => {
  await rm(fixture, { recursive: true, force: true, maxRetries: 4 });
});

it('previews without writes, consumes approvals, and verifies the bytes it publishes', async () => {
  const studio = service();
  const cancelled = await review(studio);
  expect(await readdir(parent)).toEqual([]);
  expect(await readdir(data)).toEqual([]);
  approve = async () => false;
  expect(unwrap(await studio.apply(cancelled.id))).toBeNull();
  expect(await readdir(parent)).toEqual([]);
  expect(await studio.apply(cancelled.id)).toEqual({ ok: false, error: 'GENERATOR_STALE' });

  approve = async () => true;
  const plan = await review(studio);
  const receipt = unwrap(await studio.apply(plan.id));
  expect(receipt).toMatchObject({ directory: plan.directory, fileCount: plan.files.length, selection: { projectId: expect.any(String) } });
  for (const file of plan.files) expect(sha256(await readFile(join(plan.directory, file.path)))).toBe(file.sha256);
  expect(await readFile(join(plan.directory, 'AGENTS.md'), 'utf8')).toContain('Standard Engineering profile v1');
  expect(await readdir(join(data, 'generation-v1'))).toEqual([]);
});

it('rejects case aliases and collisions created after the confirmation opens', async () => {
  const studio = service();
  await mkdir(join(parent, 'Client-Cafe'));
  const grant = unwrap(await studio.chooseParent())!;
  expect(await studio.preview({ parentId: grant.id, config })).toEqual({ ok: false, error: 'GENERATOR_DESTINATION' });
  await rm(join(parent, 'Client-Cafe'), { recursive: true });
  const plan = await review(studio);
  approve = async () => {
    await mkdir(plan.directory);
    await writeFile(join(plan.directory, 'README.md'), 'Client-owned text.');
    return true;
  };
  expect(await studio.apply(plan.id)).toEqual({ ok: false, error: 'GENERATOR_STALE' });
  expect(await readFile(join(plan.directory, 'README.md'), 'utf8')).toBe('Client-owned text.');
  expect(await readdir(data)).toEqual([]);
});

it('blocks a replaced parent and rejects selecting a link or junction as a parent', async () => {
  const studio = service();
  const plan = await review(studio);
  const moved = join(fixture, 'Moved');
  const outside = join(fixture, 'Outside');
  await mkdir(outside);
  approve = async () => {
    await rename(parent, moved);
    await symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  };
  expect(await studio.apply(plan.id)).toEqual({ ok: false, error: 'GENERATOR_STALE' });
  expect(await studio.chooseParent()).toEqual({ ok: false, error: 'GENERATOR_DESTINATION' });
  expect(await readdir(outside)).toEqual([]);
});

it('resumes from a persisted journal in a new service and rejects the wrong native parent', async () => {
  const interrupted = service(new InterruptedJournal(data));
  const plan = await review(interrupted);
  expect(await interrupted.apply(plan.id)).toEqual({ ok: false, error: 'GENERATOR_RECOVERY' });
  interrupted.dispose();
  const restarted = service();
  expect(unwrap(await restarted.pending())).toMatchObject([{ id: plan.id, createdFiles: 3 }]);
  expect(await restarted.protectsGit(plan.directory)).toBe(true);
  chosen = fixture;
  expect(await restarted.resume(plan.id)).toEqual({ ok: false, error: 'GENERATOR_DESTINATION' });
  chosen = parent;
  expect(unwrap(await restarted.resume(plan.id))?.fileCount).toBe(plan.files.length);
  expect(unwrap(await restarted.pending())).toEqual([]);
  expect(await restarted.protectsGit(plan.directory)).toBe(false);
});

it('preserves user edits and blocks junction changes before resuming writes', async () => {
  const interrupted = service(new InterruptedJournal(data));
  const plan = await review(interrupted);
  expect(await interrupted.apply(plan.id)).toEqual({ ok: false, error: 'GENERATOR_RECOVERY' });
  const protectedFile = join(plan.directory, plan.files[0]!.path);
  await writeFile(protectedFile, 'User edit.');
  const restarted = service();
  expect(await restarted.resume(plan.id)).toEqual({ ok: false, error: 'GENERATOR_CONFLICT' });
  expect(await readFile(protectedFile, 'utf8')).toBe('User edit.');
  await writeFile(protectedFile, plan.files[0]!.content);
  const outside = join(fixture, 'Outside');
  const server = join(plan.directory, 'server');
  await mkdir(outside);
  await rename(server, join(fixture, 'Moved server'));
  await symlink(outside, server, process.platform === 'win32' ? 'junction' : 'dir');
  expect((await restarted.resume(plan.id)).ok).toBe(false);
  expect(await readdir(outside)).toEqual([]);
  expect(unwrap(await restarted.pending())).toHaveLength(1);
  approve = async () => false;
  expect(unwrap(await restarted.release(plan.id))).toHaveLength(1);
  approve = async () => true;
  expect(unwrap(await restarted.release(plan.id))).toEqual([]);
  expect(await readFile(protectedFile, 'utf8')).toBe(plan.files[0]!.content);
  expect(await readdir(outside)).toEqual([]);
});

it('rejects a native parent that resides inside an existing Git working tree', async () => {
  await mkdir(join(parent, '.git'));
  await writeFile(join(parent, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  chosen = join(parent, 'Subdirectory');
  await mkdir(chosen);
  expect(await service().chooseParent()).toEqual({ ok: false, error: 'GENERATOR_DESTINATION' });
  expect(await readdir(chosen)).toEqual([]);
});
