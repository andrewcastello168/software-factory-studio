import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';
import { failure, INCREMENTAL_LIMITS, success } from '@factory/contracts';
import type {
  ErrorCode, GitState, IncrementalApproval, IncrementalInspection, IncrementalPreview, IncrementalSelection, OpenProject, Result,
} from '@factory/contracts';
import {
  classifyOwned, composeIncremental, eligibility, incrementalPaths, IncrementalUnsupported, manifestEntries,
  previousSources, readIncrementalProject, sha256,
} from '@factory/generator';
import type { LocalFile } from '@factory/generator';
import { admitRoot, pathError, pathKey } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { modelSources, readSources } from '../schema/source';
import { applyFiles, hashFile, inspectFile, isWrite, readDirectory, snapshotParents } from './files';
import { IncrementalStore, previewDigest } from './storage';
import type { RecordV1 } from './storage';

interface Grant {
  root(id: string): ProjectRoot | undefined;
  project(id: string): Promise<OpenProject | undefined>;
  git(id: string): Promise<Result<GitState>>;
  gitWriting(): boolean;
  schemaPending(path: string): Promise<boolean>;
  refresh(id: string): Promise<unknown>;
}

interface Dialog { confirm(title: string, detail: string, button: string): Promise<boolean> }

class Rejected extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

const covers = (parent: string, child: string) => {
  const rel = relative(pathKey(parent), pathKey(child));
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + sep);
};
const notices = (error: unknown) => error instanceof IncrementalUnsupported ? error.message.slice(0, 300)
  : 'The project, manifests, or migration paths could not be safely inspected.';
const protectedInputs = ['.factory/project.json', '.factory/modules.json', '.env.example'];

export class IncrementalStudio {
  #closed = false;
  #busy = false;
  #active: string | undefined;
  #ticket: { input: IncrementalSelection; record: RecordV1; root: ProjectRoot } | undefined;

  constructor(private readonly store: IncrementalStore, private readonly grant: Grant, private readonly dialogs: Dialog) {}

  dispose() { this.#closed = true; this.#ticket = undefined; }

  #root(id: string) {
    const root = !this.#closed && this.grant.root(id);
    if (!root) throw new Rejected('ACCESS_DENIED');
    return root;
  }

  async #run<T>(job: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.#busy) return failure('PROJECT_BUSY');
    this.#busy = true;
    try { return await job(); }
    catch (error) { return failure(error instanceof Rejected ? error.code : error instanceof IncrementalUnsupported
      ? 'INCREMENTAL_UNSUPPORTED' : 'INCREMENTAL_CONFLICT'); }
    finally { this.#busy = false; this.#active = undefined; }
  }

  async #context(id: string, mutation: boolean) {
    const root = this.#root(id);
    if (mutation && this.grant.gitWriting()) throw new Rejected('PROJECT_BUSY');
    const git = await this.grant.git(id);
    const state = git.ok ? git.value : { state: 'failed' as const };
    const repo = state.state === 'repository' ? state : null;
    if (mutation && (repo ? repo.operation !== null : state.state !== 'not-repository')) throw new Rejected('INCREMENTAL_CONFLICT');
    const gitIdentity = repo ? (await readDirectory(root, '.git'))?.identity ?? null : null;
    if (repo && !gitIdentity) throw new Rejected('INCREMENTAL_CONFLICT');
    const source = await readSources(root);
    const protectedFiles = await Promise.all(protectedInputs.map(async (path) => [path, await inspectFile(root, path)] as const));
    if (this.#root(id) !== root || (mutation && this.grant.gitWriting())) throw new Rejected('INCREMENTAL_STALE');
    const context = sha256(JSON.stringify([pathKey(root.path), root.identity, source.directory.identity, state.state,
      gitIdentity, repo?.branch, repo?.head, repo?.operation, source.migrations.map(({ name, sha256 }) => [name, sha256]),
      source.diagnostics, protectedFiles.map(([path, file]) => [path, hashFile(file)])]));
    return { root, repo, context, source, protectedFiles };
  }

  async #capture(id: string, mutation = false) {
    const context = await this.#context(id, mutation);
    const files = new Map<string, LocalFile>(context.protectedFiles);
    const read = async (paths: string[]) => {
      for (const path of new Set(paths)) {
        if (!files.has(path)) files.set(path, await inspectFile(context.root, path));
      }
    };
    await read(incrementalPaths);
    const project = readIncrementalProject(files);
    const entries = manifestEntries(files);
    await read(entries.filter(({ path }) => !path.startsWith('db/migrations/')).map(({ path }) => path));
    for (const migration of context.source.migrations) {
      files.set('db/migrations/' + migration.name, { state: 'text', content: migration.sql, sha256: migration.sha256 });
    }
    const history = modelSources(context.source.migrations);
    const old = modelSources(previousSources(project, context.source.migrations));
    const issues = [...context.source.diagnostics, ...history.diagnostics, ...old.diagnostics]
      .slice(0, 64).map(({ source, line, message }) => (source + (line ? ':' + line : '') + ' · ' + message).slice(0, 300));
    if (this.#root(id) !== context.root) throw new Rejected('INCREMENTAL_STALE');
    const revision = sha256(JSON.stringify([context.context, context.repo?.revision,
      [...files].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([path, file]) => [path, hashFile(file)])]));
    return { ...context, files, project, revision, schema: history.schema, oldSchema: old.schema, issues };
  }

  async #inspect(id: string): Promise<IncrementalInspection> {
    const root = this.#root(id);
    const [pending, history, opened] = await Promise.all([this.store.pending(root), this.store.history(root), this.grant.project(id)]);
    try {
      const captured = await this.#capture(id);
      const { project, files, schema, source, repo, issues } = captured;
      const ownership = new Map(project.files.map((item) => [item.path, item]));
      const seen = new Set(ownership.keys());
      const inventory = project.files.map(({ path }) => classifyOwned(path, files.get(path), ownership.get(path)));
      const untracked = new Set(repo?.changes.filter(({ index }) => index === '?').map(({ path }) => path) ?? []);
      for (const entry of opened?.entries ?? []) {
        if (entry.kind === 'directory' || seen.has(entry.path)) continue;
        const row = classifyOwned(entry.path, entry.kind === 'link' ? { state: 'unsafe' } : files.get(entry.path), undefined);
        if (row.state === 'discovered' && repo && !untracked.has(entry.path)) row.state = 'user';
        inventory.push(row);
        if (inventory.length >= INCREMENTAL_LIMITS.inventory) break;
      }
      const sources = source.migrations.map(({ name, sha256 }) => ({ name, sha256, external: !ownership.has('db/migrations/' + name) }));
      return {
        revision: captured.revision, branch: repo?.branch ?? null, head: repo?.head ?? null,
        profile: { stack: 'Node / PostgreSQL · v2', architecture: 'Layered Web · v1', engineering: 'Standard Engineering · v1',
          modules: project.config.modules.map(({ id, version }) => id + ' · ' + version) },
        tables: eligibility(project, schema), files: inventory, sources, issues, history, recovery: pending?.preview ?? null,
      };
    } catch (error) {
      this.#root(id);
      return {
        revision: sha256('unavailable'), branch: null, head: null, profile: null, tables: [], files: [], sources: [],
        issues: [notices(error)], history, recovery: pending?.preview ?? null,
      };
    }
  }

  inspect(id: string) { return this.#run(async () => success(await this.#inspect(id))); }

  async #plan(input: IncrementalSelection) {
    const captured = await this.#capture(input.projectId, true);
    if (captured.revision !== input.revision) throw new Rejected('INCREMENTAL_STALE');
    const id = randomUUID();
    const result = captured.issues.length ? { changes: [], issues: captured.issues, backend: [], frontend: [] }
      : composeIncremental(captured.project, captured.files, captured.schema, captured.oldSchema, captured.source.migrations, input);
    const affected = new Set(result.changes.filter(isWrite).map(({ path }) => path));
    if (captured.repo?.changes.some(({ path, original, index }) => index !== '.' && index !== '?'
      && (affected.has(path) || (original && affected.has(original))))) result.issues.push('Unstage affected files before applying the reviewed generation.');
    const preview = { id, ...result, digest: previewDigest(input.revision, { id, ...result }) };
    const record: RecordV1 = {
      version: 1, context: captured.context, revision: captured.revision, preview,
      directories: preview.issues.length ? {} : await snapshotParents(captured.root, preview.changes.filter(isWrite)),
    };
    return { input, record, root: captured.root };
  }

  preview(input: IncrementalSelection): Promise<Result<IncrementalPreview>> {
    return this.#run(async () => {
      this.#ticket = undefined;
      const root = this.#root(input.projectId);
      if (await this.store.pending(root)) return failure('GENERATOR_RECOVERY');
      const plan = await this.#plan(input);
      if (plan.root !== root || this.#root(input.projectId) !== root) return failure('INCREMENTAL_STALE');
      this.#ticket = plan;
      return success(plan.record.preview);
    });
  }

  async protectsGit(path: string) {
    if (this.#active && (covers(path, this.#active) || covers(this.#active, path))) return true;
    let root: ProjectRoot;
    try { root = await admitRoot(path); }
    catch (error) { if (pathError(error) === 'missing') return false; throw error; }
    return Boolean(await this.store.pending(root));
  }

  action(input: IncrementalApproval, operation: 'apply' | 'resume' | 'handoff'): Promise<Result<IncrementalInspection | null>> {
    return this.#run<IncrementalInspection | null>(async () => {
      const root = this.#root(input.projectId);
      this.#active = root.path;
      const pending = await this.store.pending(root);
      if (operation === 'handoff') {
        if (!pending || pending.preview.id !== input.id) return failure('INCREMENTAL_STALE');
        if (!await this.dialogs.confirm('Hand off incremental generation?', root.path + '\n\nKeep the worktree and any backup or staging files for manual inspection.',
          'Hand Off Recovery')) return success(null);
        if (this.#root(input.projectId) !== root) return failure('INCREMENTAL_STALE');
        await this.store.finish(root, pending, 'handed-off');
        return success(await this.#inspect(input.projectId));
      }
      const ticket = operation === 'apply' ? this.#ticket : undefined;
      const record = operation === 'resume' ? pending : ticket?.record;
      if (!record || record.preview.id !== input.id || (operation === 'apply' && (pending || ticket?.input.projectId !== input.projectId || ticket.root !== root))) {
        return failure('INCREMENTAL_STALE');
      }
      const writes = record.preview.changes.filter(isWrite);
      if (!writes.length || record.preview.issues.length) return failure('INCREMENTAL_CONFLICT');

      const authorize = async () => {
        const live = await this.#context(input.projectId, true);
        if (live.root !== root || live.context !== record.context || await this.grant.schemaPending(root.path)) {
          throw new Rejected('INCREMENTAL_STALE');
        }
      };
      const review = async () => {
        await authorize();
        if (!ticket) return;
        const refreshed = await this.#plan(ticket.input);
        if (refreshed.record.preview.digest !== record.preview.digest || refreshed.record.preview.issues.length
          || JSON.stringify(refreshed.record.directories) !== JSON.stringify(record.directories)) throw new Rejected('INCREMENTAL_STALE');
      };
      await review();
      if (!await this.dialogs.confirm(operation === 'resume' ? 'Resume reviewed generation?' : 'Apply reviewed generation?',
        root.path + '\n\nPlan SHA-256 ' + record.preview.digest + '\n\n' + writes.map(({ path, action }) => action + ' · ' + path).join('\n'),
        operation === 'resume' ? 'Resume Generation' : 'Apply Generation')) return success(null);
      await review();
      if (ticket) { await this.store.save(root, record, true); this.#ticket = undefined; }
      try {
        await applyFiles(root, record.preview.id, writes, record.directories, () => this.store.save(root, record), authorize, operation === 'resume');
        await this.store.finish(root, record, 'applied');
      } catch { return failure('GENERATOR_RECOVERY'); }
      await this.grant.refresh(input.projectId);
      return success(await this.#inspect(input.projectId));
    });
  }
}
