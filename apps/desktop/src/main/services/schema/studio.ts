import { randomUUID } from 'node:crypto';
import { join, relative, isAbsolute, sep } from 'node:path';
import { failure, SCHEMA_LIMITS, success } from '@factory/contracts';
import type {
  ErrorCode, GitState, MigrationPreview, Result, SchemaConnection, SchemaEdit, SchemaLayout, SchemaMigration,
  SchemaPhysical, SchemaPoint, SchemaSnapshot, SchemaWorkspace, SqlImport,
} from '@factory/contracts';
import { sha256 } from '@factory/generator';
import { diagnostic, parseSql, planMigration } from '@factory/schema';
import { assertVacant, publish } from '../generation/transaction';
import { admitRoot, pathError, pathKey, sameDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { isDevelopmentTarget, observeDatabase, targetLabel } from './postgres';
import { modelSources, readSources, SourceUnavailable } from './source';
import { SchemaStore } from './storage';
import type { MigrationRecord } from './storage';

interface Grant {
  root(id: string): ProjectRoot | undefined;
  git(id: string): Promise<Result<GitState>>;
  gitWriting(): boolean;
  incrementalPending?(path: string): Promise<boolean>;
  refresh(id: string): Promise<unknown>;
}

interface Dialogs {
  confirm(title: string, detail: string, action: string): Promise<boolean>;
}

class Rejected extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}

const contains = (parent: string, child: string) => {
  const path = relative(pathKey(parent), pathKey(child));
  return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
};

export class DatabaseStudio {
  #closed = false;
  #busy = false;
  #protecting: string | undefined;
  #plan: (MigrationRecord & { projectId: string }) | undefined;
  #observation: { projectId: string; revision: string; target: string; user: string; value: SchemaPhysical } | undefined;
  constructor(private readonly store: SchemaStore, private readonly grant: Grant, private readonly dialogs: Dialogs) {}

  dispose() { this.#closed = true; this.#plan = undefined; this.#observation = undefined; }

  #root(id: string) {
    const root = !this.#closed && this.grant.root(id);
    if (!root) throw new Rejected('ACCESS_DENIED');
    return root;
  }

  async #exclusive<T>(job: () => Promise<Result<T>>, unexpected: ErrorCode = 'SCHEMA_STORAGE'): Promise<Result<T>> {
    if (this.#busy) return failure('PROJECT_BUSY');
    this.#busy = true;
    try { return await job(); }
    catch (error) {
      return failure(error instanceof Rejected ? error.code : error instanceof SourceUnavailable ? 'SCHEMA_UNAVAILABLE' : unexpected);
    } finally { this.#busy = false; this.#protecting = undefined; }
  }

  async #capture(projectId: string, mutation = false) {
    const root = this.#root(projectId);
    if (mutation && this.grant.gitWriting()) throw new Rejected('PROJECT_BUSY');
    if (mutation && await this.grant.incrementalPending?.(root.path)) throw new Rejected('PROJECT_BUSY');
    const git = await this.grant.git(projectId);
    const state = git.ok ? git.value : { state: 'failed' as const };
    if (mutation && (state.state === 'repository' ? state.operation !== null : state.state !== 'not-repository')) {
      throw new Rejected('SCHEMA_CONFLICT');
    }
    const refs = state.state === 'repository' ? [state.branch, state.head, state.operation] : [state.state];
    const history = await readSources(root);
    if (this.#root(projectId) !== root) throw new Rejected('SCHEMA_STALE');
    if (mutation && this.grant.gitWriting()) throw new Rejected('PROJECT_BUSY');
    const revisionOf = (files: SchemaMigration[]) => sha256(JSON.stringify([
      pathKey(root.path), root.identity, history.directory.identity, refs, files.map(({ name, sha256: digest }) => [name, digest]), history.diagnostics,
    ]));
    const revision = revisionOf(history.migrations);
    const model = modelSources(history.migrations);
    const diagnostics = [...history.diagnostics, ...model.diagnostics].slice(0, SCHEMA_LIMITS.diagnostics);
    return { root, revision, revisionOf, model, ...history, sourceDiagnostics: diagnostics };
  }

  async #snapshot(projectId: string): Promise<SchemaSnapshot> {
    const capture = await this.#capture(projectId);
    const [layout, recovery] = await Promise.all([this.store.layout(capture.root), this.store.record(capture.root)]);
    if (this.#root(projectId) !== capture.root) throw new Rejected('SCHEMA_STALE');
    return {
      schema: capture.model.schema, migrations: capture.migrations, revision: capture.revision,
      diagnostics: capture.sourceDiagnostics, layout, recovery: recovery ? { id: recovery.id, migration: recovery.migration } : null,
    };
  }

  inspect(id: string): Promise<Result<SchemaSnapshot>> {
    return this.#exclusive(async () => success(await this.#snapshot(id)), 'SCHEMA_UNAVAILABLE');
  }

  parse(input: SqlImport) { return success(parseSql(input.sql, input.schema)); }

  preview(input: SchemaEdit): Promise<Result<MigrationPreview>> {
    return this.#exclusive<MigrationPreview>(async () => {
      this.#plan = undefined;
      const capture = await this.#capture(input.projectId, true);
      if (input.revision !== capture.revision) return failure('SCHEMA_STALE');
      if (await this.store.record(capture.root)) return failure('GENERATOR_RECOVERY');
      const id = randomUUID();
      const { sql, diagnostics } = planMigration(capture.model.schema, input.schema);
      if (capture.sourceDiagnostics.length || diagnostics.length || !sql) {
        return success({ id, migration: null, diagnostics: [...capture.sourceDiagnostics, ...diagnostics].slice(0, SCHEMA_LIMITS.diagnostics) });
      }
      const sequence = Number(capture.migrations.at(-1)?.name.slice(0, 4) ?? 0) + 1;
      if (capture.migrations.length >= SCHEMA_LIMITS.migrations || sequence > 9999
        || Buffer.byteLength(sql) > SCHEMA_LIMITS.sql
        || capture.migrations.reduce((sum, file) => sum + Buffer.byteLength(file.sql), Buffer.byteLength(sql)) > 192_000) {
        return success({ id, migration: null, diagnostics: [diagnostic('The next migration exceeds the source history limits.')] });
      }
      const migration = { name: String(sequence).padStart(4, '0') + '_schema.sql', sql, sha256: sha256(sql) };
      await assertVacant(capture.directory, migration.name);
      if (this.#root(input.projectId) !== capture.root) return failure('SCHEMA_STALE');
      this.#plan = { version: 1, id, migration, projectId: input.projectId, base: input.revision };
      return success({ id, migration, diagnostics: [] });
    });
  }

  async protectsGit(directory: string) {
    if (this.#protecting && (contains(directory, this.#protecting) || contains(this.#protecting, directory))) return true;
    try { return Boolean(await this.store.record(await admitRoot(directory))); }
    catch (error) {
      // Git clone preflights a directory which does not exist yet.
      if (pathError(error) === 'missing') return false;
      throw error;
    }
  }

  publish(input: SchemaWorkspace & { id: string }): Promise<Result<SchemaSnapshot | null>> {
    return this.#exclusive(async () => {
      const root = this.#root(input.projectId);
      this.#protecting = root.path;
      const pending = await this.store.record(root);
      const reviewed = this.#plan;
      const plan = pending ?? (reviewed?.projectId === input.projectId ? reviewed : undefined);
      if (!plan || plan.id !== input.id) return failure('SCHEMA_STALE');

      const preflight = async () => {
        const source = await this.#capture(input.projectId, true);
        const existing = source.migrations.find(({ name }) => name === plan.migration.name);
        const without = source.migrations.filter(({ name }) => name !== plan.migration.name);
        const replay = planMigration(modelSources(without).schema, modelSources([...without, plan.migration]).schema);
        if (source.root !== root || source.sourceDiagnostics.length || source.revisionOf(without) !== plan.base
          || (!pending && (input.revision !== source.revision || existing)) || (existing && existing.sha256 !== plan.migration.sha256)
          || replay.diagnostics.length || replay.sql !== plan.migration.sql) throw new Rejected('SCHEMA_STALE');
        if (!existing) await assertVacant(source.directory, plan.migration.name);
        return source.directory;
      };

      await preflight();
      if (!await this.dialogs.confirm(pending ? 'Resume migration publication?' : 'Publish a new SQL migration?',
        join(root.path, 'db', 'migrations', plan.migration.name) + '\n\nSHA-256 ' + plan.migration.sha256
        + '\n\nThis action creates a source file. Database apply needs a separate review.', pending ? 'Resume Publication' : 'Publish Migration')) return success(null);
      const directory = await preflight();
      if (!pending) {
        await this.store.saveRecord(root, { version: 1, id: plan.id, base: plan.base, migration: plan.migration });
        this.#plan = undefined;
      }
      try {
        const current = await preflight();
        if (!sameDirectory(directory.identity, current.identity)) throw new Error('Migration directory changed.');
        const stage = '.factory-stage-migration-' + plan.id;
        await publish(directory, plan.migration.name, stage, plan.migration.sql, plan.migration.sha256, async () => {
          await preflight();
        });
        const published = await this.#capture(input.projectId, true);
        const written = published.migrations.find(({ name }) => name === plan.migration.name);
        if (written?.sha256 !== plan.migration.sha256 || published.revisionOf(published.migrations.filter((file) => file !== written)) !== plan.base
          || published.sourceDiagnostics.length) return failure('GENERATOR_RECOVERY');
        await this.store.finish(root);
      } catch {
        return failure('GENERATOR_RECOVERY');
      }
      await this.grant.refresh(input.projectId);
      return success(await this.#snapshot(input.projectId));
    });
  }

  release(input: SchemaWorkspace & { id: string }): Promise<Result<SchemaSnapshot | null>> {
    return this.#exclusive(async () => {
      const root = this.#root(input.projectId);
      const record = await this.store.record(root);
      if (!record || record.id !== input.id) return failure('SCHEMA_STALE');
      if (!await this.dialogs.confirm('Hand off migration recovery?',
        root.path + '\n\nStudio will remove its local recovery record. Existing SQL and staging files are preserved for manual inspection.',
        'Hand Off Recovery')) return success(null);
      if (this.#root(input.projectId) !== root) return failure('ACCESS_DENIED');
      await this.store.finish(root);
      return success(await this.#snapshot(input.projectId));
    });
  }

  layout(input: SchemaLayout): Promise<Result<SchemaPoint[]>> {
    return this.#exclusive(async () => {
      const source = await this.#capture(input.projectId);
      if (source.revision !== input.revision) return failure('SCHEMA_STALE');
      // Layout data is versioned in Studio user data, independent of source SQL.
      await this.store.saveLayout(source.root, input.points);
      return success(input.points);
    });
  }

  physical(input: SchemaConnection, apply = false): Promise<Result<SchemaPhysical | null>> {
    return this.#exclusive(async () => {
      const initial = await this.#capture(input.projectId, apply);
      if (initial.revision !== input.revision) return failure('SCHEMA_STALE');
      const target = targetLabel(input);
      const observation = this.#observation;
      if (apply) {
        this.#protecting = initial.root.path;
        if (!isDevelopmentTarget(input) || initial.sourceDiagnostics.length || !initial.model.safe || !observation
          || observation.projectId !== input.projectId || observation.revision !== input.revision
          || observation.target !== target || observation.user !== input.user || !observation.value.pending?.length
          || observation.value.diagnostics.length || await this.store.record(initial.root)) return failure('SCHEMA_CONFLICT');
      }
      const action = apply ? 'Apply Development Migrations' : 'Inspect Read-only';
      const selected = initial.migrations.filter(({ name }) => observation?.value.pending?.includes(name));
      const detail = target + '\nUser ' + input.user + '\n\n' + (apply
        ? 'Confirm that this is a disposable or local development database. PostgreSQL will apply the following files in a transaction. Schema changes may hold locks.\n\n'
          + selected.map(({ name, sha256: digest }) => name + ' · ' + digest).join('\n').slice(0, 3500)
        : 'Studio will query the selected PostgreSQL catalog and migration ledger in a read-only transaction.');
      if (!await this.dialogs.confirm(apply ? 'Apply reviewed development migrations?' : 'Inspect a PostgreSQL database?', detail, action)) return success(null);
      const authorize = async () => {
        const current = await this.#capture(input.projectId, apply);
        if (current.root !== initial.root || current.revision !== initial.revision) throw new Rejected('SCHEMA_STALE');
      };
      await authorize();
      const result = await observeDatabase(input, initial.migrations, !initial.sourceDiagnostics.length, apply, authorize, observation?.value);
      if (!apply) await authorize();
      this.#observation = { projectId: input.projectId, revision: input.revision, target, user: input.user, value: result };
      return success(result);
    }, 'SCHEMA_DATABASE');
  }
}
