import { link, mkdir, open, opendir, readdir, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { GENERATOR_LIMITS } from '@factory/contracts';
import { sha256 } from '@factory/generator';
import type { StarterPlan } from '@factory/generator';
import { checkedDirectory, directoryIdentity, readBoundedFile, sameDirectory, withDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { optionalStat, syncDirectory } from './journal';
import type { GenerationRecord } from './journal';

export class GenerationConflict extends Error {}

function outputDirectories(plan: StarterPlan) {
  const names = new Map<string, Set<string>>([['', new Set()]]);
  for (const file of plan.files) {
    const parts = file.path.split('/');
    let parent = '';
    for (const segment of parts.slice(0, -1)) {
      names.get(parent)!.add(segment);
      parent = parent ? parent + '/' + segment : segment;
      if (!names.has(parent)) names.set(parent, new Set());
    }
    names.get(parent)!.add(parts.at(-1)!);
  }
  return names;
}

const directoryPart = (path: string) => path.split('/').slice(0, -1).join('/');
const stageName = (id: string, position: number) => '.factory-stage-' + id + '-' + position;

export async function assertVacant(root: ProjectRoot, name: string) {
  await withDirectory(root.path, root.identity, async (opened) => {
    const directory = await opendir(opened);
    let inspected = 0;
    for await (const entry of directory) {
      if (++inspected > 25_000 || entry.name.normalize('NFC').toLowerCase() === name.toLowerCase()) {
        throw new GenerationConflict('Destination exists or its parent exceeds the inspection limit.');
      }
    }
  });
}

async function newDirectory(parent: ProjectRoot, name: string) {
  return withDirectory(parent.path, parent.identity, async (opened) => {
    await mkdir(join(opened, name), { mode: 0o700 });
    const entry = await optionalStat(join(opened, name));
    if (!entry?.isDirectory()) throw new GenerationConflict('The new directory changed.');
    const path = join(parent.path, name);
    const identity = directoryIdentity(await checkedDirectory(path, directoryIdentity(entry)));
    await syncDirectory(opened);
    return { path, identity };
  });
}

async function fileMatches(path: string, digest: string) {
  const stat = await optionalStat(path);
  return stat ? readBoundedFile(path, stat, GENERATOR_LIMITS.fileBytes, (bytes) => sha256(bytes) === digest) : null;
}

async function publish(root: ProjectRoot, name: string, temporary: string, content: string, digest: string) {
  await withDirectory(root.path, root.identity, async (opened) => {
    const target = join(opened, name);
    const stage = join(opened, temporary);
    let existing = await fileMatches(target, digest);
    if (existing === false) throw new GenerationConflict('An output file differs from the reviewed plan.');
    const staged = await fileMatches(stage, digest);
    if (staged === false) throw new GenerationConflict('A staging file contains unexpected bytes.');
    if (existing === null) {
      if (staged === null) {
        const handle = await open(stage, 'wx', 0o600);
        try {
          await handle.writeFile(content, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
      }
      if (await fileMatches(stage, digest) !== true) throw new GenerationConflict('Staging verification failed.');
      await checkedDirectory(root.path, root.identity);
      // A same-directory hard link publishes the complete bytes and fails on
      // any occupied target name, including a link or file created by an editor.
      await link(stage, target);
      await syncDirectory(opened);
      existing = await fileMatches(target, digest);
    }
    if (existing !== true) throw new GenerationConflict('Published content could not be verified.');
    if (await fileMatches(stage, digest) === true) await unlink(stage);
    await syncDirectory(opened);
  });
}

export async function runGeneration(
  plan: StarterPlan,
  record: GenerationRecord,
  save: (record: GenerationRecord) => Promise<void>,
  assertActive: () => void,
): Promise<ProjectRoot> {
  if (plan.digest !== record.digest || record.createdFiles > plan.files.length) throw new GenerationConflict('The installed template changed.');
  const names = outputDirectories(plan);
  if (Object.keys(record.directories).some((path) => !names.has(path))) throw new GenerationConflict('Unexpected journal path.');
  const plannedParents = [...names.keys()];
  const roots = new Map<string, ProjectRoot>();
  // Resume inspects all existing directories and planned payloads before
  // creating anything else. Missing or replaced recorded directories block.
  const allowed = new Map([...names].map(([name, entries]) => [name, new Set(entries)]));
  for (const [index, file] of plan.files.entries()) {
    allowed.get(directoryPart(file.path))!.add(stageName(record.id, index));
  }
  for (const relative of plannedParents) {
    const identity = record.directories[relative];
    if (!identity) continue;
    const root = { path: join(record.parent.path, record.config.slug, relative), identity };
    await withDirectory(root.path, root.identity, async (opened) => {
      for (const entry of await readdir(opened)) {
        const child = relative ? relative + '/' + entry : entry;
        if (!allowed.get(relative)?.has(entry) || (names.has(child) && !Object.hasOwn(record.directories, child))) {
          throw new GenerationConflict('Unexpected file or unrecorded directory. Preserve the folder for manual review.');
        }
      }
    });
    roots.set(relative, root);
  }
  for (const [index, file] of plan.files.entries()) {
    const parent = roots.get(directoryPart(file.path));
    if (!parent) {
      if (index < record.createdFiles) throw new GenerationConflict('A recorded output is missing.');
      continue;
    }
    await withDirectory(parent.path, parent.identity, async (opened) => {
      const contents = await fileMatches(join(opened, basename(file.path)), file.sha256);
      if (contents === false || (contents === null && index < record.createdFiles)
        || await fileMatches(join(opened, stageName(record.id, index)), file.sha256) === false) {
        throw new GenerationConflict('A generated file was changed or removed.');
      }
    });
  }
  await checkedDirectory(record.parent.path, record.parent.identity);
  for (const relative of plannedParents) {
    assertActive();
    if (roots.has(relative)) continue;
    const parent = relative ? roots.get(directoryPart(relative))! : record.parent;
    const root = await newDirectory(parent, relative ? basename(relative) : record.config.slug);
    roots.set(relative, root);
    record.directories[relative] = root.identity;
    await save(record);
  }
  const destination = roots.get('')!;
  for (const [index, file] of plan.files.entries()) {
    assertActive();
    await publish(roots.get(directoryPart(file.path))!, basename(file.path), stageName(record.id, index), file.content, file.sha256);
    if (index >= record.createdFiles) {
      record.createdFiles = index + 1;
      await save(record);
    }
  }
  for (const [relative, entries] of names) {
    const root = roots.get(relative)!;
    const actual = await withDirectory(root.path, root.identity, (opened) => readdir(opened));
    if (actual.length !== entries.size || actual.some((entry) => !entries.has(entry))) {
      throw new GenerationConflict('Final directory contents differ from the preview.');
    }
  }
  for (const file of plan.files) {
    const root = roots.get(directoryPart(file.path))!;
    const verified = await withDirectory(root.path, root.identity, (opened) => fileMatches(join(opened, basename(file.path)), file.sha256));
    if (verified !== true) throw new GenerationConflict('Final file fingerprints differ from the preview.');
  }
  const verified = directoryIdentity(await checkedDirectory(destination.path, destination.identity));
  if (!sameDirectory(verified, destination.identity)) throw new GenerationConflict('Destination identity changed.');
  return destination;
}
