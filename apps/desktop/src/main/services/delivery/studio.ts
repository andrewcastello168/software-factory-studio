import { randomUUID } from 'node:crypto';
import { link, mkdir, open, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { parseEnv } from 'node:util';
import { failure, GO_STACK, requiredQuality, success } from '@factory/contracts';
import type { ErrorCode, GitState, PackageRequest, ReleaseEvidence, Result, ShareExport, ShareImport, SharedLibrary } from '@factory/contracts';
import { readSharedBundle, sharedBundle } from '@factory/generator';
import { assertVacant, publish } from '../generation/transaction';
import { optionalStat, syncDirectory } from '../generation/journal';
import { admitRoot, checkedDirectory, withDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { scanProject } from '../projects/scan';
import { inspectFile, readDirectory } from '../incremental/files';
import { archiveLimit, builtFiles, payloadDigest, revisionSnapshot, safeBytes, safePackText, shaBytes, tar } from './files';
import type { LibraryStore } from '../library';
import type { DeveloperStudio } from '../developer/studio';
import type { DeliveryStore } from './store';

interface Grant {
  root(id: string): ProjectRoot | undefined;
  git(id: string): Promise<Result<GitState>>;
  available(path: string): boolean;
  pending(path: string): Promise<boolean>;
  refresh(id: string): Promise<unknown>;
}
interface Dialogs {
  chooseDirectory(title: string): Promise<string | null>;
  confirm(title: string, detail: string, action: string): Promise<boolean>;
}
class Rejected extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
const sharePath = 'factory-library';
const bundleName = /^([0-9a-f]{64})\.json$/u;

export class DeliveryStudio {
  #closed = false;
  #busy = new Set<string>();
  constructor(private readonly grant: Grant, private readonly dialogs: Dialogs, private readonly developer: DeveloperStudio,
    private readonly store: DeliveryStore, private readonly library: LibraryStore) {}

  dispose() { this.#closed = true; }

  #root(id: string) {
    const root = !this.#closed && this.grant.root(id);
    if (!root) throw new Rejected('ACCESS_DENIED');
    return root;
  }

  async #result<T>(work: () => Promise<T>): Promise<Result<T>> {
    try { return success(await work()); }
    catch (error) { return failure(error instanceof Rejected ? error.code : 'DELIVERY_CONFLICT'); }
  }

  async #guard(id: string, root: ProjectRoot) {
    await checkedDirectory(root.path, root.identity);
    if (this.#root(id) !== root) throw new Rejected('DELIVERY_STALE');
  }

  async #capture(id: string) {
    const root = this.#root(id);
    const app = await this.developer.capture(id, false);
    const git = await this.grant.git(id);
    if (!git.ok) throw new Rejected('DELIVERY_BLOCKED');
    await this.#guard(id, root);
    const repo = git.value.state === 'repository' ? git.value : null;
    const source = await revisionSnapshot(root, git.value).catch(() => null);
    const lockNames = app.stack?.manifests.filter((path) => path.endsWith('.yaml') || path === 'go.sum') ?? [];
    const locks = await Promise.all(lockNames.map(async (name) => ({
      name, digest: await safeBytes(root, name, 12 * 1024 * 1024).then(shaBytes).catch(() => null),
    })));
    return { root, app, repo, source, locks, clean: Boolean(repo?.head && !repo.operation && !repo.changes.length) };
  }

  inspect(id: string) {
    return this.#result(async () => {
      const { root, app, repo, source, locks, clean } = await this.#capture(id);
      const history = await this.store.read(root);
      const releases = [];
      for (const release of history.releases) {
        let artifact: 'available' | 'missing' | 'changed' | 'unavailable' = 'unavailable';
        try {
          const directory = await admitRoot(dirname(release.file));
          const stat = await optionalStat(release.file);
          if (!stat) artifact = 'missing';
          else if (stat.size !== BigInt(release.bytes)) artifact = 'changed';
          else if (this.grant.available(directory.path)) artifact = shaBytes(await safeBytes(directory, basename(release.file), archiveLimit)) === release.sha256 ? 'available' : 'changed';
        } catch { /* A relocated, unsafe or inaccessible artifact cannot be trusted. */ }
        releases.push({ release, artifact });
      }
      await this.#guard(id, root);
      const template = app.project?.config.library?.template;
      return { stack: app.stack?.id ?? null, name: app.project?.config.name ?? basename(root.path),
        project: app.project?.projectId ?? null, template: template ? template.name + ' · v' + template.version : null,
        worktree: repo?.worktreeId ?? root.path,
        branch: repo?.branch ?? null, head: repo?.head ?? null, clean, source: source?.source ?? null,
        environment: app.info.environment.filter(({ configured }) => !configured).map(({ name }) => name),
        locks, quality: history.quality, releases };
    });
  }

  package(input: PackageRequest) {
    return this.#result(async () => {
      const { projectId } = input;
      const root = this.#root(projectId);
      if (this.#busy.has(root.path)) throw new Rejected('PROJECT_BUSY');
      this.#busy.add(root.path);
      try {
        const ready = async () => {
          const current = await this.#capture(projectId);
          const { app, repo, clean, locks, source } = current;
          if (current.root !== root || source?.source !== input.source) throw new Rejected('DELIVERY_STALE');
          if (!clean || !repo?.head || !app.project || !app.stack || locks.some(({ digest }) => !digest) || await this.grant.pending(root.path)) {
            throw new Rejected('DELIVERY_BLOCKED');
          }
          const history = await this.store.read(root);
          const prior = history.releases.find(({ version }) => version === input.version);
          const required = requiredQuality(app.stack.id);
          const failedOptional = ['audit', 'vulnerability', 'postgres'].some((task) =>
            history.quality.find((item) => item.task === task && item.source === source.source && item.outcome !== 'interrupted')?.outcome === 'failed');
          if (failedOptional) throw new Rejected('DELIVERY_BLOCKED');
          const verified = required.map((task) => history.quality.find((item) => item.task === task && item.source === source.source));
          const output = verified.find((item) => item?.task === 'build')?.output;
          if (!output || verified.some((item) => item?.outcome !== 'passed')) throw new Rejected('DELIVERY_BLOCKED');
          return { app, head: repo.head, locks, source, checks: verified.map((item) => item!.id), output, prior };
        };
        const planned = await ready();
        const requested = await this.dialogs.chooseDirectory('Choose a directory for the release archive');
        if (!requested) return null;
        const destination = await admitRoot(requested);
        if (!this.grant.available(destination.path)) throw new Rejected('ACCESS_DENIED');
        const filename = planned.app.project!.config.slug + '-' + input.version + '.tar';
        await assertVacant(destination, filename);
        const go = planned.app.stack!.id === GO_STACK;
        const prepare = async () => {
          const verified = await ready();
          if (JSON.stringify([verified.output, verified.checks]) !== JSON.stringify([planned.output, planned.checks])) throw new Rejected('DELIVERY_STALE');
          const files = await builtFiles(root, go);
          if (payloadDigest(files) !== verified.output) throw new Rejected('DELIVERY_STALE');
          if (!go) {
            const emitted = files.filter(({ path }) => path.startsWith('dist/server/')).map(({ path }) => path.replace(/^dist\//u, '').replace(/\.js$/u, '.ts'));
            if (emitted.some((path) => !verified.source.paths.includes(path))) throw new Rejected('DELIVERY_BLOCKED');
          }
          const sourcePaths = verified.source.paths.filter((path) => /^db\/migrations\/\d{4}_[a-z0-9_]+\.sql$/u.test(path));
          if (verified.source.paths.some((path) => path.startsWith('db/migrations/') && !sourcePaths.includes(path))) throw new Rejected('DELIVERY_BLOCKED');
          const consumed = go ? sourcePaths : ['package.json', 'pnpm-lock.yaml', ...sourcePaths];
          for (const path of consumed) files.push({ path, bytes: safePackText(await safeBytes(root, path, 12 * 1024 * 1024)) });
          const local = await inspectFile(root, '.env');
          if (local.state === 'text') {
            const settings = parseEnv(local.content);
            const secrets = Object.entries(settings).filter(([name]) => /(?:PASSWORD|SECRET|TOKEN|KEY|DATABASE_URL)/iu.test(name))
              .flatMap(([name, value]) => {
                if (!value) return [];
                if (!name.endsWith('DATABASE_URL')) return [value];
                try { return [value, decodeURIComponent(new URL(value).password)]; } catch { return [value]; }
              }).filter((value) => value.length >= 6);
            if (files.some(({ bytes }) => secrets.some((secret) => bytes.includes(secret)))) throw new Rejected('DELIVERY_BLOCKED');
          }
          return files;
        };
        const files = await prepare();
        const platform = go ? process.platform + '-' + process.arch : 'Node.js 22.16.0';
        const extension = go && process.platform === 'win32' ? '.exe' : '';
        const migration = go ? 'dist/factory-migrate' + extension : 'node dist/server/migrate.js';
        const identity = planned.app.project!.config.modules.some(({ id }) => id === 'authentication');
        const docs = '# Client release\n\nRuntime: ' + platform + '\n\n'
          + (go ? 'Run the included dist/factory-server executable from the extracted root. On Windows use the .exe suffix.\n'
            : 'Use pnpm 10.13.1. Run pnpm install --prod --frozen-lockfile --ignore-scripts, then node dist/server/server.js from the extracted root.\n')
          + '\nProvide a reviewed DATABASE_URL, HOST and PORT. Check /api/health and /api/ready.\n'
          + '\nAfter reviewing the database target and backup, apply migrations explicitly with `' + migration + '`.\n'
          + (identity ? '\nSet AUTH_ORIGIN to the exact HTTPS origin. For initial admin setup, provide AUTH_BOOTSTRAP_EMAIL and run '
            + '`node dist/server/features/identity/bootstrap.js` from an interactive terminal. Supply the password at the prompt.\n' : '');
        const proof = {
          version: input.version, project: planned.app.project!.projectId, stack: planned.app.stack!.id, revision: planned.head, platform, locks: planned.locks,
          quality: requiredQuality(planned.app.stack!.id), files: files.map(({ path, bytes }) => ({ path, sha256: shaBytes(bytes) })),
        };
        files.push({ path: 'DELIVERY.md', bytes: Buffer.from(docs) }, { path: 'release-evidence.json', bytes: Buffer.from(JSON.stringify(proof, null, 2) + '\n') });
        const archive = tar(files);
        const release: ReleaseEvidence = {
          id: randomUUID(), name: planned.app.project!.config.name, version: input.version, stack: planned.app.stack!.id,
          source: planned.source.source, head: planned.head, created: new Date().toISOString(), file: join(destination.path, filename),
          sha256: shaBytes(archive), bytes: archive.length, notes: input.notes, lock: shaBytes(Buffer.from(JSON.stringify(planned.locks))), checks: planned.checks,
        };
        if (planned.prior && (planned.prior.file !== release.file || planned.prior.sha256 !== release.sha256
          || planned.prior.source !== release.source || planned.prior.notes !== release.notes)) throw new Rejected('DELIVERY_CONFLICT');
        if (!await this.dialogs.confirm('Package verified client release?', root.path + '\n\n' + release.file
          + '\n\nSource ' + release.head + '\nSHA-256 ' + release.sha256 + '\n\n' + files.map(({ path }) => path).join('\n'), 'Package Release')) return null;
        if (payloadDigest(await prepare()) !== payloadDigest(files.slice(0, -2))) throw new Rejected('DELIVERY_STALE');
        await assertVacant(destination, filename);
        if (!planned.prior) await this.store.release(root, release);
        await withDirectory(destination.path, destination.identity, async (opened) => {
          const temporary = join(opened, '.factory-release-' + release.id + '.tmp');
          const handle = await open(temporary, 'wx', 0o600);
          try {
            try { await handle.writeFile(archive); await handle.sync(); }
            finally { await handle.close(); }
            await ready();
            await link(temporary, join(opened, filename));
            await syncDirectory(opened);
          } finally { await unlink(temporary).catch(() => undefined); }
        });
        if (shaBytes(await safeBytes(destination, filename, archiveLimit)) !== release.sha256) throw new Rejected('DELIVERY_CONFLICT');
        return planned.prior ?? release;
      } finally { this.#busy.delete(root.path); }
    });
  }

  async #shareContext(id: string) {
    const root = this.#root(id);
    const git = await this.grant.git(id);
    if (!git.ok || git.value.state !== 'repository' || git.value.operation) throw new Rejected('DELIVERY_BLOCKED');
    await this.#guard(id, root);
    return { root, repo: git.value };
  }

  async #bundle(root: ProjectRoot, name: string) {
    const bytes = await safeBytes(root, sharePath + '/' + name, 90_000);
    const bundle = readSharedBundle(bytes.toString('utf8'));
    if (name !== bundle.digest + '.json') throw new Rejected('DELIVERY_CONFLICT');
    return bundle;
  }

  shares(id: string) {
    return this.#result<SharedLibrary>(async () => {
      const { root } = await this.#shareContext(id);
      const directory = await readDirectory(root, sharePath);
      if (!directory) return { entries: [], rejected: 0 };
      const scan = await scanProject(directory);
      const entries: SharedLibrary['entries'] = [];
      let rejected = 0;
      for (const { path, kind } of scan.entries) {
        if (entries.length >= 80 || !bundleName.test(path) || kind !== 'file') { rejected++; continue; }
        try { entries.push((await this.#bundle(root, path)).overview); }
        catch { rejected++; }
      }
      if (scan.partial) rejected++;
      await this.#guard(id, root);
      return { entries, rejected };
    });
  }

  export(input: ShareExport) {
    return this.#result(async () => {
      const { projectId } = input;
      const { root, repo } = await this.#shareContext(projectId);
      const existingDirectory = await readDirectory(root, sharePath);
      const library = await this.library.list();
      if (!library.ok) throw new Rejected('LIBRARY_CONFLICT');
      const assets = input.assets.flatMap(({ id, version }) => library.value.filter((item) => item.id === id && item.version === version));
      if (assets.length !== input.assets.length) throw new Rejected('DELIVERY_STALE');
      const bundle = sharedBundle(assets);
      const filename = bundle.digest + '.json';
      if (!await this.dialogs.confirm('Export engineering assets?', join(root.path, sharePath) + '\n\n' + filename + '\n'
        + assets.map(({ name, version }) => name + ' v' + version).join('\n'), 'Export Bundle')) return null;
      const current = await this.#shareContext(projectId);
      if (current.root !== root || current.repo.revision !== repo.revision) throw new Rejected('DELIVERY_STALE');
      if (!existingDirectory) await withDirectory(root.path, root.identity, async (opened) => {
        await assertVacant(root, sharePath);
        await mkdir(join(opened, sharePath), { mode: 0o700 });
        await syncDirectory(opened);
      });
      const directory = await readDirectory(root, sharePath);
      if (!directory || (existingDirectory && JSON.stringify(existingDirectory.identity) !== JSON.stringify(directory.identity))) {
        throw new Rejected('DELIVERY_STALE');
      }
      const path = join(directory.path, filename);
      const before = await optionalStat(path);
      if (before) {
        if ((await this.#bundle(root, filename)).digest !== bundle.digest) throw new Rejected('DELIVERY_CONFLICT');
      } else {
        await assertVacant(directory, filename);
        await publish(directory, filename, '.factory-share-' + randomUUID(), bundle.content, bundle.digest,
          () => this.#guard(projectId, root));
      }
      await this.grant.refresh(projectId);
      return bundle.overview;
    });
  }

  import(input: ShareImport) {
    return this.#result(async () => {
      const { root, repo } = await this.#shareContext(input.projectId);
      const filename = input.digest + '.json';
      const chosen = await this.#bundle(root, filename);
      if (!await this.dialogs.confirm('Import exact engineering versions?', root.path + '\n\n' + filename + '\n'
        + chosen.assets.map(({ name, version }) => name + ' v' + version).join('\n'), 'Import Bundle')) return null;
      const imported = await this.library.importExact(chosen.assets, async () => {
        const current = await this.#shareContext(input.projectId);
        if (current.root !== root || current.repo.revision !== repo.revision || (await this.#bundle(root, filename)).digest !== chosen.digest) {
          throw new Rejected('DELIVERY_STALE');
        }
      });
      if (!imported.ok) throw new Rejected(imported.error);
      return imported.value;
    });
  }
}
