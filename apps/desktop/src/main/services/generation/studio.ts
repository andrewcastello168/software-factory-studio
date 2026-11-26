import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { failure, GENERATOR_LIMITS, isStarterConfig, PROJECT_LIMITS, success } from '@factory/contracts';
import type {
  ErrorCode, GeneratorParent, GeneratorPending, GeneratorPreview, GeneratorReceipt, GeneratorRequest, ProjectSelection, Result, StarterConfig,
} from '@factory/contracts';
import { planLegacyProject, planProject, InvalidCrud } from '@factory/generator';
import type { StarterPlan } from '@factory/generator';
import { admitRoot, checkedDirectory, pathKey, sameDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { optionalStat } from './journal';
import type { GenerationJournal, GenerationRecord } from './journal';
import { assertVacant, GenerationConflict, runGeneration } from './transaction';

interface Workspace {
  canOpen(): boolean;
  adopt(root: ProjectRoot): Promise<Result<ProjectSelection>>;
}

interface Dialogs {
  choose(title: string, defaultPath?: string): Promise<string | null>;
  confirm(title: string, detail: string, action: string): Promise<boolean>;
}

class Rejected extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

const inside = (root: string, child: string) => {
  const path = relative(pathKey(root), pathKey(child));
  return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
};

const target = (record: GenerationRecord) => join(record.parent.path, record.config.slug);

async function inspectParent(parent: ProjectRoot) {
  await checkedDirectory(parent.path, parent.identity);
  // Initial generation has no source workspace or Git refs. Do not turn a
  // nested directory into a project inside an existing checkout.
  let location = parent.path;
  for (;;) {
    const marker = join(location, '.git');
    const entry = await optionalStat(marker);
    if (entry && (!entry.isDirectory() || await optionalStat(join(marker, 'HEAD')))) {
      throw new Rejected('GENERATOR_DESTINATION');
    }
    const upper = dirname(location);
    if (upper === location) break;
    location = upper;
  }
}

export class GeneratorStudio {
  #parent: { id: string; root: ProjectRoot } | undefined;
  #plan: { id: string; plan: StarterPlan<GeneratorRequest['config']>; parent: ProjectRoot } | undefined;
  #closed = false;
  #busy = false;
  #writing: string | undefined;

  constructor(private readonly journal: GenerationJournal, private readonly workspace: Workspace, private readonly dialogs: Dialogs) {}

  dispose() {
    this.#closed = true;
    this.#parent = undefined;
    this.#plan = undefined;
  }

  #assertActive = () => {
    if (this.#closed) throw new Rejected('ACCESS_DENIED');
  };

  async #exclusive<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.#closed) return failure('ACCESS_DENIED');
    if (this.#busy) return failure('PROJECT_BUSY');
    this.#busy = true;
    try {
      return await operation();
    } catch (error) {
      return failure(error instanceof Rejected ? error.code : 'GENERATOR_DESTINATION');
    } finally {
      this.#busy = false;
    }
  }

  chooseParent(): Promise<Result<GeneratorParent | null>> {
    return this.#exclusive(async () => {
      const selection = await this.dialogs.choose('Choose Parent Folder for New Project');
      if (!selection) return success(null);
      this.#assertActive();
      this.#plan = undefined;
      this.#parent = undefined;
      const root = await admitRoot(selection);
      await inspectParent(root);
      this.#assertActive();
      const id = randomUUID();
      this.#parent = { id, root };
      return success({ id, directory: root.path });
    });
  }

  preview(request: GeneratorRequest): Promise<Result<GeneratorPreview>> {
    return this.#exclusive(async () => {
      this.#plan = undefined;
      const parent = this.#parent;
      if (!parent || parent.id !== request.parentId) return failure('ACCESS_DENIED');
      let plan: StarterPlan<StarterConfig>;
      try { plan = planProject(request.config, randomUUID()); }
      catch (error) { if (error instanceof InvalidCrud) return failure('SCHEMA_CONFLICT'); throw error; }
      const directory = join(parent.root.path, plan.config.slug);
      if (directory.length > PROJECT_LIMITS.absolutePath - 200) return failure('GENERATOR_DESTINATION');
      await inspectParent(parent.root);
      await assertVacant(parent.root, plan.config.slug);
      const pending = await this.#records();
      if (pending.some((record) => inside(target(record), directory) || inside(directory, target(record)))) {
        return failure('GENERATOR_RECOVERY');
      }
      this.#assertActive();
      const id = randomUUID();
      this.#plan = { id, plan, parent: parent.root };
      return success({ id, digest: plan.digest, config: plan.config, directory, files: plan.files });
    });
  }

  async #records() {
    try {
      return await this.journal.list();
    } catch {
      throw new Rejected('GENERATOR_STORAGE');
    }
  }

  async pending(): Promise<Result<GeneratorPending[]>> {
    if (this.#closed) return failure('ACCESS_DENIED');
    try {
      const records = await this.#records();
      return success(records.map((record) => ({
        id: record.id, name: record.config.name, directory: target(record), createdFiles: record.createdFiles,
      })));
    } catch {
      return failure('GENERATOR_STORAGE');
    }
  }

  async protectsGit(directory: string) {
    const overlaps = (other: string) => inside(other, directory) || inside(directory, other);
    return (this.#writing && overlaps(this.#writing)) || (await this.#records()).some((record) => overlaps(target(record)));
  }

  apply(id: string): Promise<Result<GeneratorReceipt | null>> {
    return this.#exclusive(async () => {
      const reviewed = this.#plan;
      if (!reviewed || reviewed.id !== id) return failure('GENERATOR_STALE');
      this.#plan = undefined;
      if (!this.workspace.canOpen()) return failure('PROJECT_LIMIT');
      const { parent, plan } = reviewed;
      const record: GenerationRecord = {
        version: 1, id, parent, projectId: plan.projectId, digest: plan.digest, config: plan.config, directories: {}, createdFiles: 0,
      };
      const preflight = async () => {
        try {
          await inspectParent(parent);
          await assertVacant(parent, plan.config.slug);
        } catch {
          throw new Rejected('GENERATOR_STALE');
        }
        const records = await this.#records();
        if (records.length >= GENERATOR_LIMITS.pending) throw new Rejected('GENERATOR_STORAGE');
        if (records.some((entry) => inside(target(entry), target(record)) || inside(target(record), target(entry)))) {
          throw new Rejected('GENERATOR_RECOVERY');
        }
        this.#assertActive();
      };
      await preflight();
      if (!await this.dialogs.confirm('Create and verify project?',
        target(record) + '\n\n' + String(plan.files.length) + ' new files\nPlan SHA-256: ' + plan.digest
          + '\n\nDependencies, scripts and databases are separate terminal actions.', 'Generate Project')) return success(null);
      await preflight();
      try {
        await this.journal.save(record, true);
      } catch {
        return failure('GENERATOR_STORAGE');
      }
      return this.#run(plan, record);
    });
  }

  resume(id: string): Promise<Result<GeneratorReceipt | null>> {
    return this.#exclusive(async () => {
      const record = (await this.#records()).find((entry) => entry.id === id);
      if (!record) return failure('GENERATOR_STALE');
      const plan = isStarterConfig(record.config) ? planProject(record.config, record.projectId) : planLegacyProject(record.config, record.projectId);
      if (plan.digest !== record.digest) return failure('GENERATOR_CONFLICT');
      const selected = await this.dialogs.choose('Reauthorize the Project Parent Folder', record.parent.path);
      if (!selected) return success(null);
      const root = await admitRoot(selected);
      if (pathKey(root.path) !== pathKey(record.parent.path) || !sameDirectory(root.identity, record.parent.identity)) {
        return failure('GENERATOR_DESTINATION');
      }
      await inspectParent(record.parent);
      const approved = await this.dialogs.confirm('Resume interrupted generation?',
        target(record) + '\n\nThe saved plan creates only matching or missing outputs. Changed, moved or unexpected files stay in place.'
          + '\nPlan SHA-256: ' + plan.digest, 'Resume Generation');
      if (!approved) return success(null);
      this.#assertActive();
      await inspectParent(record.parent);
      return this.#run(plan, record);
    });
  }

  release(id: string): Promise<Result<GeneratorPending[]>> {
    return this.#exclusive(async () => {
      const record = (await this.#records()).find((entry) => entry.id === id);
      if (!record) return failure('GENERATOR_STALE');
      const approved = await this.dialogs.confirm('Hand off generation recovery?',
        'Close the saved record and review the folder in your editor. Studio will leave all files in place and will no longer resume this plan.\n\n'
          + target(record), 'Close Recovery Record');
      if (!approved) return this.pending();
      this.#assertActive();
      const current = (await this.#records()).find((entry) => entry.id === id);
      if (!current || JSON.stringify(current) !== JSON.stringify(record)) return failure('GENERATOR_STALE');
      try {
        await this.journal.finish(id);
      } catch {
        return failure('GENERATOR_STORAGE');
      }
      return this.pending();
    });
  }

  async #run(plan: StarterPlan, record: GenerationRecord): Promise<Result<GeneratorReceipt>> {
    this.#writing = target(record);
    let root: ProjectRoot;
    try {
      root = await runGeneration(plan, record, (next) => this.journal.save(next), this.#assertActive);
      await this.journal.finish(record.id);
    } catch (error) {
      return failure(error instanceof GenerationConflict ? 'GENERATOR_CONFLICT' : 'GENERATOR_RECOVERY');
    } finally {
      this.#writing = undefined;
    }
    const opened = this.workspace.canOpen() ? await this.workspace.adopt(root).catch(() => null) : null;
    return success({ directory: root.path, fileCount: plan.files.length, selection: opened?.ok ? opened.value : null });
  }
}
