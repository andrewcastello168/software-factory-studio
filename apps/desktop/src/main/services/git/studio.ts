import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { failure, GIT_LIMIT, isGitOid, success } from '@factory/contracts';
import type {
  GitAction, GitCloneRequest, GitCloneResult, GitCompareRequest, GitDiff, GitDiffRequest, GitOutcome,
  GitState, ProjectSelection, Result,
} from '@factory/contracts';
import { admitRoot, checkedDirectory, pathKey } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { GitFailure, NativeGit } from './process';
import type { Transport } from './process';
import {
  checkoutTree, checkWorktreePath, inspectRepository, localRemotePath, publicHttps, repositoryConfig,
  RestrictedRepository,
} from './repository';
import type { RemoteConfig, RepositorySnapshot } from './repository';

interface GitDialogs {
  confirm(title: string, detail: string, action: string): Promise<boolean>;
  chooseDirectory(title: string, defaultPath?: string): Promise<string | null>;
}

interface GitWorkspace {
  root(id: string): ProjectRoot | undefined;
  canOpen(): boolean;
  allowsAuxiliaryPath(path: string): boolean;
  adopt(root: ProjectRoot): Promise<Result<ProjectSelection>>;
  refresh(id: string): Promise<unknown>;
  generationPending?(directory: string): Promise<boolean>;
}

type Inspected = RepositorySnapshot | Exclude<GitState, { state: 'repository' }>;

const staleMessage = 'The repository changed since review. Refresh and review the updated state before retrying.';
class StaleRepository extends GitFailure {
  constructor() { super(staleMessage); }
}

const conflictMessage = 'Finish or abort the in-progress Git operation in your Git client before retrying.';
const patchArgs = ['--no-ext-diff', '--no-textconv', '--no-color', '--ignore-submodules=all'];
const patchOptions = { readOnly: true, limit: GIT_LIMIT.patch, patch: true };

const stateOf = (value: Inspected): GitState => 'config' in value ? value.state : value;
const repository = (value: Inspected): value is RepositorySnapshot => 'config' in value;
const errorMessage = (error: unknown) => error instanceof GitFailure ? error.message : 'Studio could not safely complete the Git operation.';
function patchResult({ bytes, truncated }: { bytes: Buffer; truncated: boolean }): GitDiff {
  const sanitized = bytes.toString('utf8').replace(/(?![\t\n])[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) => character === '\r' ? '' : `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`);
  const lines = sanitized.split('\n', 3001);
  return {
    text: lines.slice(0, 3000).join('\n').slice(0, GIT_LIMIT.patch),
    truncated: truncated || sanitized.length > GIT_LIMIT.patch || lines.length > 3000,
  };
}

interface ApprovedRemote {
  address: string;
  kind: Transport;
  root?: ProjectRoot;
  hash?: string;
}

export class GitStudio {
  #native: Promise<NativeGit | null> | undefined;
  #writeLocked = false;
  #disposed = false;
  #job: Promise<unknown> = Promise.resolve();
  #reading = new Map<string, Promise<Result<GitState>>>();

  constructor(private readonly workspace: GitWorkspace, private readonly dialogs: GitDialogs) {}

  async #git() {
    this.#native ??= NativeGit.open((path) => this.workspace.allowsAuxiliaryPath(path)).catch((error: unknown) => {
      this.#native = undefined;
      throw error;
    });
    const git = await this.#native;
    if (git && [git.executable, git.scratch].some((path) => !this.workspace.allowsAuxiliaryPath(path))) {
      throw new GitFailure('An open project contains the Git executable or temporary storage. Open a narrower project folder.');
    }
    return git;
  }

  async dispose() {
    this.#disposed = true;
    await this.#job;
    await (await this.#native)?.dispose();
  }

  async #inspect(git: NativeGit | null, id: string): Promise<Inspected> {
    const root = this.workspace.root(id);
    if (!root || this.#disposed) return { state: 'missing', detail: 'Open this folder again to use Git Studio.' };
    if (!git) return { state: 'unavailable', detail: 'Install native Git in a supported system location and restart Studio.' };
    try {
      await checkedDirectory(root.path, root.identity);
    } catch {
      return { state: 'missing', detail: 'The authorized project folder moved or is unavailable.' };
    }
    try {
      const result = await inspectRepository(git, root);
      if (this.#disposed || this.workspace.root(id) !== root) return { state: 'missing', detail: 'The project grant is no longer active.' };
      return result;
    } catch (error) {
      return { state: error instanceof RestrictedRepository ? 'unsupported' : 'failed', detail: errorMessage(error) };
    }
  }

  status(id: string): Promise<Result<GitState>> {
    if (!this.workspace.root(id) || this.#disposed) return Promise.resolve(failure('ACCESS_DENIED'));
    const cached = this.#reading.get(id);
    if (cached) return cached;
    const reading = this.#git().then(async (git) => success(stateOf(await this.#inspect(git, id))))
      .catch((error: unknown) => success<GitState>({ state: 'unavailable', detail: errorMessage(error) }))
      .finally(() => this.#reading.delete(id));
    this.#reading.set(id, reading);
    return reading;
  }

  async #expect(git: NativeGit, id: string, revision: string | null) {
    const root = this.workspace.root(id);
    const current = await this.#inspect(git, id);
    if (!root || this.workspace.root(id) !== root || this.#disposed) throw new StaleRepository();
    if (!repository(current)) throw new GitFailure(current.detail);
    if (revision !== current.state.revision) throw new StaleRepository();
    return { root, current };
  }

  async diff(request: GitDiffRequest): Promise<Result<GitDiff>> {
    const { id, revision, row, area } = request;
    if (!this.workspace.root(id) || this.#disposed) return failure('ACCESS_DENIED');
    try {
      const git = await this.#git();
      if (!git) return failure('GIT_DIFF_UNAVAILABLE');
      const { root, current } = await this.#expect(git, id, revision);
      const paths = current.raw[row];
      const change = current.state.changes[row];
      if (!paths || !change || (area === 'working' ? change.worktree : change.index) === '.') return failure('GIT_DIFF_UNAVAILABLE');
      const untracked = change.worktree === '?' && area === 'working';
      if (area === 'working') for (const path of paths) await checkWorktreePath(root, path);
      const args = untracked
        ? ['diff', '--no-index', '--no-ext-diff', '--no-color', '--', '/dev/null', change.path]
        : ['diff', ...patchArgs, ...(area === 'staged' ? ['--cached'] : []), '--', ...paths];
      const result = await git.repo(root.path, args, { ...patchOptions, accept: untracked ? [0, 1] : [0] });
      this.#assertGrant(id, root);
      return success(patchResult(result));
    } catch (error) {
      return failure(error instanceof StaleRepository ? 'GIT_STALE' : 'GIT_DIFF_UNAVAILABLE');
    }
  }

  async compare(request: GitCompareRequest): Promise<Result<GitDiff>> {
    if (!this.workspace.root(request.id) || this.#disposed) return failure('ACCESS_DENIED');
    try {
      const git = await this.#git();
      if (!git) return failure('GIT_DIFF_UNAVAILABLE');
      const { root, current } = await this.#expect(git, request.id, request.revision);
      const target = current.state.branches.find((branch) => branch.ref === request.ref);
      if (!target || !current.state.head) return failure('GIT_DIFF_UNAVAILABLE');
      const result = await git.repo(root.path, ['diff', ...patchArgs, current.state.head, target.oid, '--'], patchOptions);
      this.#assertGrant(request.id, root);
      return success(patchResult(result));
    } catch (error) {
      return failure(error instanceof StaleRepository ? 'GIT_STALE' : 'GIT_DIFF_UNAVAILABLE');
    }
  }

  #assertGrant(id: string, root: ProjectRoot) {
    if (this.#disposed || this.workspace.root(id) !== root) throw new StaleRepository();
  }

  async #assertNoGeneration(directory: string) {
    if (await this.workspace.generationPending?.(directory)) {
      throw new GitFailure('Resume or review the interrupted generation before changing this repository.');
    }
  }

  #write<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.#disposed) return Promise.resolve(failure('ACCESS_DENIED'));
    if (this.#writeLocked) return Promise.resolve(failure('PROJECT_BUSY'));
    this.#writeLocked = true;
    const job = operation().finally(() => { this.#writeLocked = false; });
    this.#job = job.catch(() => undefined);
    return job;
  }

  action(request: GitAction): Promise<Result<GitOutcome>> {
    if (!this.workspace.root(request.id)) return Promise.resolve(failure('ACCESS_DENIED'));
    return this.#write(async () => {
      let git: NativeGit | null = null;
      let level: GitOutcome['level'] = 'error';
      let message: string;
      try {
        git = await this.#git();
        const root = this.workspace.root(request.id);
        if (root) await this.#assertNoGeneration(root.path);
        if (!git) throw new GitFailure('Install native Git in a supported system location and restart Studio.');
        const result = request.operation === 'init'
          ? await this.#init(git, request.id)
          : await this.#operate(git, request);
        level = result === null ? 'cancelled' : 'success';
        message = result ?? 'Git operation cancelled.';
      } catch (error) {
        message = errorMessage(error);
      }
      if (this.workspace.root(request.id)) await this.workspace.refresh(request.id);
      return success({ status: stateOf(await this.#inspect(git, request.id)), message, level });
    });
  }

  async #init(git: NativeGit, id: string) {
    const root = this.workspace.root(id);
    if (!root || stateOf(await this.#inspect(git, id)).state !== 'not-repository') {
      throw new GitFailure('Initialization requires an admitted folder outside an existing repository.');
    }
    if (!await this.dialogs.confirm('Initialize Git repository?', `Create .git in this folder with initial branch main. Source files stay in place.\n\n${root.path}`, 'Initialize')) return null;
    if (stateOf(await this.#inspect(git, id)).state !== 'not-repository') throw new StaleRepository();
    this.#assertGrant(id, root);
    const metadata = join(root.path, '.git');
    await this.#assertNoGeneration(root.path);
    await checkedDirectory(root.path, root.identity);
    await mkdir(metadata, { mode: 0o700 });
    await checkedDirectory(metadata);
    this.#assertGrant(id, root);
    await git.repo(root.path, ['init', '--initial-branch=main', '--template=']);
    return 'Git repository initialized.';
  }

  async #operate(git: NativeGit, request: Exclude<GitAction, { operation: 'init' }>) {
    const { id, revision } = request;
    const { root, current } = await this.#expect(git, id, revision);
    const state = current.state;
    const recheck = () => this.#expect(git, id, revision);
    const context = `Repository: ${root.path}\nCurrent branch: ${state.branch ?? 'Detached HEAD'}\nHEAD: ${state.head ?? 'Unborn'}`;
    if (state.operation) throw new GitFailure(conflictMessage);
    if (current.hiddenChanges) throw new GitFailure('This index uses skip-worktree or assume-unchanged entries. Review them in your Git client before writing.');

    if (request.operation === 'stage' || request.operation === 'unstage') {
      const change = state.changes[request.row];
      const paths = current.raw[request.row];
      const stage = request.operation === 'stage';
      if (!change?.actionable || !paths || (stage ? change.worktree === '.' : change.index === '.' || change.index === '?')) {
        throw new GitFailure('Select a supported change before updating the index.');
      }
      const fingerprint = await Promise.all(paths.map((path) => checkWorktreePath(root, path, stage)));
      await recheck();
      for (const [index, path] of paths.entries()) {
        if (await checkWorktreePath(root, path, stage) !== fingerprint[index]) throw new StaleRepository();
      }
      this.#assertGrant(id, root);
      await git.repo(root.path, stage ? ['add', '--', ...paths]
        : state.head ? ['restore', '--staged', `--source=${state.head}`, '--', ...paths]
          : ['update-index', '--force-remove', '--', ...paths]);
      return stage ? 'Selected change staged.' : 'Selected change unstaged.';
    }

    if (request.operation === 'commit') {
      const staged = state.changes.filter((change) => change.index !== '.' && change.index !== '?');
      if (!staged.length || staged.some((change) => !change.actionable)) throw new GitFailure('Review and stage supported changes before committing.');
      if (!state.branch) throw new GitFailure('Create or switch to a branch before committing from detached HEAD.');
      if (!current.config.entries.get('user.name') || !current.config.entries.get('user.email')) {
        throw new GitFailure('Set user.name and user.email in this repository before committing.');
      }
      for (const change of staged) {
        for (const path of [change.path, change.original]) if (path !== null) await checkWorktreePath(root, path);
      }
      const list = staged.slice(0, 18).map((entry) => `${entry.index}  ${entry.path}`).join('\n');
      const summary = request.message.trim().split('\n')[0]!.slice(0, 160);
      if (!await this.dialogs.confirm('Commit staged changes?',
        `${context}\n\n${staged.length} staged path(s)\n${list}${staged.length > 18 ? '\nMore paths are shown in Git Studio.' : ''}\n\n${summary}`, 'Commit')) return null;
      await recheck();
      this.#assertGrant(id, root);
      await git.repo(root.path, ['commit', '--no-gpg-sign', '--file=-', '--cleanup=verbatim'], { input: request.message });
      return 'Staged changes committed.';
    }

    if (request.operation === 'create') {
      if (!state.head) throw new GitFailure('Create an initial commit before creating another branch.');
      const target = `refs/heads/${request.name}`;
      if (state.branches.some((branch) => branch.ref.toLowerCase() === target.toLowerCase())) throw new GitFailure('That local branch already exists.');
      await git.repo(root.path, ['check-ref-format', target], { readOnly: true });
      if (!await this.dialogs.confirm('Create local branch?', `${context}\n\nCreate ${target} at ${state.head}. The current checkout stays in place.`, 'Create Branch')) return null;
      await recheck();
      this.#assertGrant(id, root);
      await git.repo(root.path, ['branch', '--no-track', '--', request.name, state.head]);
      return 'Local branch created. The active checkout is unchanged.';
    }

    if (request.operation === 'switch') {
      const target = state.branches.find((branch) => branch.ref === request.ref);
      const name = target?.ref.slice(11);
      if (!target || !name || name.startsWith('-') || name === state.branch) throw new GitFailure('Select a different local branch.');
      if (state.changes.length) {
        throw new GitFailure('Checkout is blocked while staged, unstaged, or untracked changes exist. Review the changes and cancel checkout.');
      }
      const preflight = async () => {
        if (state.head) await checkoutTree(git, root, state.head, true);
        await checkoutTree(git, root, target.oid, true);
      };
      await preflight();
      if (!await this.dialogs.confirm('Switch the checked-out branch?',
        `${context}\n\nSwitch to ${target.ref}\nTarget: ${target.oid}\nThe working folder stays the same. Save any pending editor changes first.`, 'Switch Branch')) return null;
      await preflight();
      await recheck();
      this.#assertGrant(id, root);
      await git.repo(root.path, ['switch', '--no-guess', '--no-overwrite-ignore', '--', name]);
      return 'Branch switched and project refreshed.';
    }

    if (request.operation !== 'fetch' && request.operation !== 'pull' && request.operation !== 'push') {
      throw new GitFailure('Git operation unavailable.');
    }
    const name = request.operation === 'fetch' ? request.remote : state.upstreamRemote;
    const remote = current.config.remotes.find((entry) => entry.name === name);
    if (!remote) throw new GitFailure('Configure a supported remote and tracking branch before continuing.');
    const merge = state.branch ? current.config.entries.get(`branch.${state.branch}.merge`) : undefined;
    const tracking = merge ? `refs/remotes/${remote.name}/${merge.slice(11)}` : '';
    if (request.operation !== 'fetch' && (!merge || !state.head || !state.branch)) {
      throw new GitFailure('Pull and push require a checked-out branch with a configured upstream.');
    }
    if (request.operation === 'pull' && state.changes.length) throw new GitFailure('Fast-forward pull requires a clean working tree.');
    const approved = await this.#remote(git, remote);
    if (!approved) return null;
    if (approved.root && pathKey(approved.root.path) === pathKey(root.path)) throw new GitFailure('The local remote must be a separate bare repository.');
    const operation = request.operation === 'pull' ? 'Fast-forward Pull' : request.operation === 'push' ? 'Push' : 'Fetch';
    const direction = request.operation === 'push' ? `${state.head} → ${merge}`
      : request.operation === 'pull' ? `${merge} → ${state.branch} (fast-forward only)` : 'Remote branches → local remote-tracking refs';
    if (!await this.dialogs.confirm(`${operation} from Git Studio?`,
      `${context}\n\nRemote: ${remote.name}\nEndpoint: ${approved.root?.path ?? approved.address}\n${direction}`, operation)) return null;
    await this.#verifyRemote(git, approved);
    await recheck();
    this.#assertGrant(id, root);
    const options = { transport: approved.kind };
    if (request.operation === 'push') {
      await git.repo(root.path, ['push', '--no-verify', '--recurse-submodules=no', '--porcelain', '--', approved.address, `${state.head}:${merge}`], options);
      // A URL-based push deliberately avoids remote.* settings. Refresh the
      // tracking ref using the same explicit remote policy.
      try {
        await this.#verifyRemote(git, approved);
        await recheck();
        this.#assertGrant(id, root);
        await git.repo(root.path, ['fetch', '--no-tags', '--no-recurse-submodules', '--refmap=', '--',
          approved.address, `+${merge}:${tracking}`], options);
      } catch {
        throw new GitFailure('The push completed. The tracking refresh failed. Fetch to update the displayed divergence.');
      }
      return 'Commit history pushed to the approved upstream.';
    }
    const refspec = request.operation === 'fetch' ? `+refs/heads/*:refs/remotes/${remote.name}/*` : `+${merge}:${tracking}`;
    await git.repo(root.path, ['fetch', '--no-tags', '--no-recurse-submodules', '--refmap=', '--', approved.address, refspec], options);
    if (request.operation === 'fetch' || !state.head) return 'Remote-tracking branches fetched.';
    const after = await this.#inspect(git, id);
    if (!repository(after) || after.state.head !== state.head || after.state.branch !== state.branch || after.state.operation
      || after.state.changes.length || after.hiddenChanges || after.config.hash !== current.config.hash) {
      throw new GitFailure('Fetch completed. Local state changed, so no checkout was applied.');
    }
    const target = after.state.branches.find((branch) => branch.ref === tracking);
    if (!target) throw new GitFailure('Fetch completed. The upstream branch could not be verified.');
    if (target.oid === state.head) return 'Branch is already up to date.';
    const ancestry = await git.repo(root.path, ['merge-base', '--is-ancestor', state.head, target.oid], { readOnly: true, accept: [0, 1] });
    if (ancestry.code !== 0) {
      const reverse = await git.repo(root.path, ['merge-base', '--is-ancestor', target.oid, state.head], { readOnly: true, accept: [0, 1] });
      if (reverse.code === 0) return 'Local branch already contains the upstream commits.';
      throw new GitFailure('Fetch completed. Branches diverged, so the pull made no checkout changes. Compare the upstream branch.');
    }
    await checkoutTree(git, root, state.head, true);
    await checkoutTree(git, root, target.oid, true);
    await this.#expect(git, id, after.state.revision);
    this.#assertGrant(id, root);
    await git.repo(root.path, ['merge', '--ff-only', '--no-autostash', '--no-overwrite-ignore', '--no-edit', target.oid, '--']);
    return 'Branch fast-forwarded and project refreshed.';
  }

  async #remote(git: NativeGit, remote: RemoteConfig): Promise<ApprovedRemote | null> {
    if (remote.kind === 'https') {
      const address = publicHttps(remote.value);
      if (address) return { address, kind: 'https' };
    }
    if (remote.kind === 'local') {
      const path = localRemotePath(remote.value);
      if (path) {
        const selected = await this.dialogs.chooseDirectory('Authorize Local Bare Git Remote', path);
        if (!selected) return null;
        const root = await admitRoot(selected);
        if (pathKey(root.path) !== pathKey(path)) throw new GitFailure('The selected bare repository does not match the configured remote.');
        return this.#bare(git, root);
      }
    }
    throw new GitFailure('Use unauthenticated HTTPS or explicitly admit a local bare repository. SSH and other transports are unavailable.');
  }

  async #bare(git: NativeGit, root: ProjectRoot): Promise<ApprovedRemote> {
    const config = await repositoryConfig(git, root, true);
    return { address: pathToFileURL(root.path).href, kind: 'file', root, hash: config.hash };
  }

  async #verifyRemote(git: NativeGit, approved: ApprovedRemote) {
    if (approved.root && (await repositoryConfig(git, approved.root, true)).hash !== approved.hash) {
      throw new GitFailure('The approved local remote changed. Select it and review the operation again.');
    }
  }

  clone(request: GitCloneRequest): Promise<Result<GitCloneResult>> {
    return this.#write(async () => {
      let created = false;
      try {
        const git = await this.#git();
        if (!git) throw new GitFailure('Install native Git in a supported system location and restart Studio.');
        if (!this.workspace.canOpen()) throw new GitFailure('Close a project tab before cloning.');
        const cancelled = success<GitCloneResult>({ selection: null, message: 'Clone cancelled.', level: 'cancelled' });
        const address = request.source === 'https' ? publicHttps(request.url) : null;
        if (request.source === 'https' && !address) {
          throw new GitFailure('Enter a plain HTTPS repository URL without credentials, query parameters, or fragments.');
        }
        let approved: ApprovedRemote;
        if (request.source === 'local') {
          const source = await this.dialogs.chooseDirectory('Select a Local Bare Git Repository');
          if (!source) return cancelled;
          approved = await this.#bare(git, await admitRoot(source));
        } else {
          approved = { address: address!, kind: 'https' };
        }
        const selected = await this.dialogs.chooseDirectory('Choose Clone Destination Parent');
        if (!selected) return cancelled;
        const parent = await admitRoot(selected);
        const destination = join(parent.path, request.name);
        await this.#assertNoGeneration(destination);
        if (!await this.dialogs.confirm('Clone repository into a new folder?',
          `Source: ${approved.root?.path ?? approved.address}\nDestination: ${destination}\nProject scripts and submodules stay inactive.`, 'Clone')) return cancelled;
        if (this.#disposed || !this.workspace.canOpen()) return cancelled;
        await this.#verifyRemote(git, approved);
        await this.#assertNoGeneration(destination);
        await checkedDirectory(parent.path, parent.identity);
        await mkdir(destination, { mode: 0o700 });
        created = true;
        const root = await admitRoot(destination);
        await checkedDirectory(parent.path, parent.identity);
        if (this.#disposed) throw new StaleRepository();
        await git.run(git.scratch, ['clone', '--no-local', '--no-checkout', '--no-recurse-submodules', '--template=', '--origin', 'origin',
          '--', approved.address, root.path], { transport: approved.kind });
        const config = await repositoryConfig(git, root);
        const resolved = await git.repo(root.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], { readOnly: true, accept: [0, 1] });
        const head = resolved.bytes.toString('ascii').trim();
        if (isGitOid(head)) {
          await checkoutTree(git, root, head, true);
          if (this.#disposed || config.hash !== (await repositoryConfig(git, root)).hash) throw new StaleRepository();
          await git.repo(root.path, ['read-tree', '-m', '-u', head]);
        } else if (resolved.code === 0) {
          throw new GitFailure('Git returned an invalid HEAD.');
        }
        const result = await this.workspace.adopt(root);
        return result.ok ? success({ selection: result.value, message: 'Repository cloned and opened.', level: 'success' })
          : success({ selection: null, message: 'Clone completed. Use Open Folder to admit the new directory.', level: 'warning' });
      } catch (error) {
        return success({ selection: null, level: 'error',
          message: `${errorMessage(error)}${created ? ' Review the destination folder for any files Git left behind.' : ''}` });
      }
    });
  }
}
