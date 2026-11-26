import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { failure, GIT_LIMIT, isGitOid, isGitRef, success } from '@factory/contracts';
import type {
  GitAdvancedOutcome, GitApproved, GitReview, GitReviewInput, GitScope, GitStash, GitState, GitWorktree, GitWorkspaceDetails, ProjectSelection, Result,
} from '@factory/contracts';
import { admitRoot, checkedDirectory, pathKey, readBoundedFile } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { GitCommandFailure, GitFailure } from './process';
import type { NativeGit } from './process';
import { checkWorktreePath, checkoutTree, digest, inspectRepository, isLocalGitPath, pathIsMissing, safeGitPath } from './repository';
import type { RepositorySnapshot } from './repository';
import { patchArgs, patchOptions, patchResult } from './presentation';
import type { GitRecoveryStore, Recovery } from './recovery';

type Context = { root: ProjectRoot; current: RepositorySnapshot };
type Candidate = { parent?: ProjectRoot; target?: ProjectRoot; path?: string };
interface Plan {
  view: Omit<GitReview, 'ticket'>;
  binding: string[];
  execute?: () => Promise<{ message: string; selection?: ProjectSelection; warning?: boolean }>;
}

interface Host {
  git(): Promise<NativeGit | null>;
  root(id: string): ProjectRoot | undefined;
  expect(git: NativeGit, scope: GitScope): Promise<Context>;
  assertGrant(id: string, root: ProjectRoot): void;
  noPending(path: string): Promise<void>;
  choose(title: string, defaultPath?: string): Promise<string | null>;
  confirm(title: string, detail: string, action: string): Promise<boolean>;
  write(operation: () => Promise<Result<GitAdvancedOutcome>>): Promise<Result<GitAdvancedOutcome>>;
  status(git: NativeGit | null, id: string): Promise<GitState>;
  refresh(id: string): Promise<unknown>;
  canOpen(): boolean;
  auxiliary(path: string): boolean;
  adopt(root: ProjectRoot): Promise<Result<ProjectSelection>>;
  stale(error: unknown): boolean;
  reveal?(path: string): void;
}

const readonly = { readOnly: true };
const stale = () => new GitFailure('The reviewed Git state changed. Refresh and review the operation again.');
const message = (error: unknown) => error instanceof GitFailure ? error.message : 'Studio could not safely complete the reviewed Git operation.';
const words = (buffer: Buffer) => new TextDecoder('utf-8', { fatal: true }).decode(buffer);
const parts = (buffer: Buffer) => words(buffer).split('\0').filter(Boolean);
const asView = (title: string, detail: string, files: string[] = []): Plan =>
  ({ view: { title, detail, files, blocked: null, patch: null, versions: [] }, binding: [] });

async function stat(path: string) {
  try { return await lstat(path, { bigint: true }); }
  catch (error) { if (pathIsMissing(error)) return null; throw error; }
}

async function text(path: string, max = 64_000) {
  const info = await stat(path);
  return info ? readBoundedFile(path, info, max, words) : null;
}

function overlaps(a: string, b: string) {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}
function overlapPath(a: string, b: string) {
  return a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
}

async function worktrees(git: NativeGit, { root, current }: Context): Promise<GitWorktree[]> {
  const output = await git.repo(root.path, ['worktree', 'list', '--porcelain', '-z'], readonly);
  const items = words(output.bytes).split('\0\0').filter(Boolean);
  if (items.length > 64) throw new GitFailure('There are too many linked worktrees to review.');
  return items.map((item) => {
    const fields = item.split('\0').filter(Boolean);
    const first = fields[0] ?? '';
    const path = first.slice('worktree '.length);
    const head = fields.find((line) => line.startsWith('HEAD '))?.slice(5);
    const branch = fields.find((line) => line.startsWith('branch '))?.slice(7);
    if (!first.startsWith('worktree ') || !isLocalGitPath(path) || /[\p{Cf}\uFFFD]/u.test(path)
      || (branch !== undefined && !isGitRef(branch))) throw new GitFailure('A worktree has an unsupported path or branch.');
    return {
      path, head: isGitOid(head) && !/^0+$/u.test(head) ? head : null, branch: branch ?? null,
      primary: pathKey(current.metadata.primary) === pathKey(path), active: pathKey(root.path) === pathKey(path),
      locked: fields.some((line) => line === 'locked' || line.startsWith('locked ')),
      missing: fields.some((line) => line === 'prunable' || line.startsWith('prunable ')),
    };
  });
}

async function stashEntries(git: NativeGit, root: ProjectRoot): Promise<GitStash[]> {
  const result = await git.repo(root.path, ['stash', 'list', '--format=%H%x00%gs', '-z'], readonly);
  const rows = words(result.bytes).split('\0');
  if (rows.pop() !== '' || rows.length % 2 !== 0 || rows.length > 256) throw new GitFailure('Stash history exceeds the supported review limit.');
  const stashes: GitStash[] = [];
  for (let index = 0; index < rows.length; index += 2) {
    const oid = rows[index];
    if (!isGitOid(oid)) throw new GitFailure('Git returned an unsupported stash.');
    const label = (rows[index + 1] ?? '').replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, 500);
    stashes.push({ oid, label: label || 'Stash' });
  }
  return stashes;
}

async function conflicts(git: NativeGit, root: ProjectRoot) {
  const result = await git.repo(root.path, ['ls-files', '--unmerged', '-z'], readonly);
  const rows = new Map<string, { index: number; oid: string }[]>();
  for (const line of parts(result.bytes)) {
    const item = /^(100644|100755) ([a-f0-9]+) ([123])\t(.+)$/u.exec(line);
    if (!item || !isGitOid(item[2]) || !safeGitPath(item[4]!)) {
      throw new GitFailure('A conflict contains an unsupported path or file type. Review it in your Git client.');
    }
    const list = rows.get(item[4]!) ?? [];
    list.push({ index: Number(item[3]), oid: item[2] });
    rows.set(item[4]!, list);
    if (rows.size > GIT_LIMIT.changes) throw new GitFailure('There are too many conflicts to review.');
  }
  return rows;
}

async function changedPaths(git: NativeGit, root: ProjectRoot, from: string, to: string) {
  const result = await git.repo(root.path, ['diff', '--name-only', '--no-renames', '-z', ...patchArgs, from, to, '--'], readonly);
  const files = parts(result.bytes);
  if (files.length > GIT_LIMIT.changes || !files.every(safeGitPath)) throw new GitFailure('Some affected paths cannot be reviewed safely.');
  return files;
}

async function ignored(git: NativeGit, root: ProjectRoot) {
  const result = await git.repo(root.path, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], readonly);
  const files = parts(result.bytes).map((name) => name.replace(/\/$/u, ''));
  if (files.length > GIT_LIMIT.changes || !files.every(safeGitPath)) throw new GitFailure('Ignored paths exceed the supported protection boundary.');
  return files;
}
async function protectIgnored(git: NativeGit, root: ProjectRoot, files: string[]) {
  const hidden = await ignored(git, root);
  const names = files.map((file) => file.toLowerCase());
  if (hidden.some((path) => names.some((name) => overlapPath(name, path.toLowerCase())))) {
    throw new GitFailure('An ignored local file or directory may collide with the operation.');
  }
  return hidden;
}

const safeAttributes = (content: string) => content.split(/\r?\n/u).every((row) => {
  const line = row.trim();
  if (!line || line.startsWith('#')) return true;
  const [pattern, ...attributes] = line.split(/\s+/u);
  return Boolean(pattern && !/[[\]"\\]/u.test(pattern) && attributes.length
    && attributes.every((item) => /^(?:text(?:=auto)?|-text|eol=(?:lf|crlf))$/u.test(item)));
});

async function workspaceAttributes(context: Context, paths: string[]) {
  const { root, current } = context;
  const common = join(current.metadata.common, 'info', 'attributes');
  const files = new Set(['.gitattributes']);
  for (const path of paths) {
    const components = path.split('/');
    for (let depth = 1; depth < components.length; depth++) {
      files.add(components.slice(0, depth).join('/') + '/.gitattributes');
    }
  }
  const locations = [common];
  for (const path of files) {
    if (await checkWorktreePath(root, path) !== 'missing') locations.push(join(root.path, ...path.split('/')));
  }
  const hashes: string[] = [];
  for (const path of locations) {
    const contents = await text(path);
    if (contents !== null) {
      if (!safeAttributes(contents)) throw new GitFailure('Git attributes contain merge or filter settings outside Studio policy.');
      hashes.push(digest(pathKey(path), contents));
    }
  }
  return hashes;
}

async function reviewedTrees(git: NativeGit, context: Context, oids: string[], checkExisting = true) {
  const { root } = context;
  const attributes = new Set<string>();
  const paths = new Set<string>();
  for (const oid of new Set(oids)) {
    for (const item of await checkoutTree(git, root, oid, checkExisting)) {
      paths.add(item.path);
      if (/(?:^|\/)\.gitattributes$/iu.test(item.path)) attributes.add(item.oid);
    }
  }
  for (const oid of attributes) {
    const value = await git.repo(root.path, ['cat-file', 'blob', oid], { ...readonly, limit: 64_000 });
    if (!safeAttributes(words(value.bytes))) throw new GitFailure('A reviewed tree contains unsupported Git attributes.');
  }
  return workspaceAttributes(context, [...paths]);
}

async function parents(git: NativeGit, root: ProjectRoot, oid: string) {
  const output = await git.repo(root.path, ['rev-list', '--parents', '-n', '1', oid, '--'], { ...readonly, limit: 4096 });
  const [commit, ...list] = words(output.bytes).trim().split(' ');
  if (commit !== oid || !list.every(isGitOid)) throw new GitFailure('Git could not verify the commit parents.');
  return list;
}

async function commits(git: NativeGit, root: ProjectRoot, include: string, exclude: string, unpublished = false) {
  const result = await git.repo(root.path, ['rev-list', '--max-count=25', include, '^' + exclude, ...(unpublished ? ['--not', '--remotes'] : []), '--'], readonly);
  const list = words(result.bytes).trim().split('\n').filter(Boolean);
  if (!list.every(isGitOid) || list.length > 24) throw new GitFailure('Review at most 24 commits in a single history operation.');
  return list;
}

function candidateRef(context: Context, source: string) {
  if (isGitRef(source)) {
    const oid = context.current.state.branches.find(({ ref }) => ref === source)?.oid;
    if (oid) return oid;
  } else if (isGitOid(source)) return source;
  throw new GitFailure('Select a visible branch or a full commit ID.');
}

function assertPaths(paths: (string[] | null)[]) {
  if (paths.some((path) => !path)) throw new GitFailure('Some changed paths cannot be represented safely.');
  return [...new Set(paths.flatMap((path) => path ?? []))];
}

function requireAuthor(context: Context) {
  if (!context.current.config.entries.get('user.name') || !context.current.config.entries.get('user.email')) {
    throw new GitFailure('Configure repository-local user.name and user.email for this operation.');
  }
}

function clean({ current }: Context) {
  if (current.state.changes.length) throw new GitFailure('Commit or stash all staged, unstaged and untracked changes first.');
}

export class AdvancedGit {
  #tickets = new Map<string, { id: string; input: GitReviewInput; candidate: Candidate; seal: string }>();
  constructor(private readonly host: Host, private readonly recoveries: GitRecoveryStore) {}

  async details(scope: GitScope): Promise<Result<GitWorkspaceDetails>> {
    if (!this.host.root(scope.id)) return failure('ACCESS_DENIED');
    try {
      const git = await this.host.git();
      if (!git) return failure('GIT_DIFF_UNAVAILABLE');
      const context = await this.host.expect(git, scope);
      const [linked, stashes, staged] = await Promise.all([worktrees(git, context), stashEntries(git, context.root), conflicts(git, context.root)]);
      this.host.assertGrant(scope.id, context.root);
      return success({ worktrees: linked, stashes, conflicts: [...staged.keys()],
        recovery: Boolean(context.current.state.operation && (await this.recoveries.read(context.current.metadata.worktreeId))?.kind === context.current.state.operation) });
    } catch (error) {
      return failure(this.host.stale(error) ? 'GIT_STALE' : 'GIT_DIFF_UNAVAILABLE');
    }
  }

  async review(input: GitReviewInput): Promise<Result<GitReview | null>> {
    if (!this.host.root(input.id)) return failure('ACCESS_DENIED');
    try {
      const git = await this.host.git();
      if (!git) return failure('GIT_DIFF_UNAVAILABLE');
      const context = await this.host.expect(git, input);
      const candidate: Candidate = {};
      if (input.kind === 'worktree-add') {
        const directory = await this.host.choose('Choose Parent for New Worktree');
        if (!directory) return success(null);
        candidate.parent = await admitRoot(directory);
        if (pathKey(directory) !== pathKey(candidate.parent.path)) throw new GitFailure('Choose a canonical destination without linked directories.');
        candidate.path = join(candidate.parent.path, input.folder);
      } else if (input.kind === 'worktree-open' || input.kind === 'worktree-remove' || input.kind === 'worktree-inspect') {
        const item = (await worktrees(git, context))[input.row];
        if (!item || pathKey(item.path) !== pathKey(input.path) || item.active || item.missing) throw new GitFailure('Select an available separate worktree.');
        if (input.kind === 'worktree-remove' && (item.primary || item.locked)) throw new GitFailure('Primary and locked worktrees are protected.');
        const directory = await this.host.choose('Authorize Registered Worktree Folder', item.path);
        if (!directory) return success(null);
        candidate.target = await admitRoot(directory);
        if (pathKey(directory) !== pathKey(item.path) || pathKey(candidate.target.path) !== pathKey(item.path)) throw stale();
      }
      const current = await this.host.expect(git, input);
      if (current.root !== context.root) throw stale();
      const plan = await this.#plan(git, current, input, candidate);
      this.host.assertGrant(input.id, context.root);
      let ticket: string | null = null;
      if (plan.execute && !plan.view.blocked) {
        if (this.#tickets.size >= 16) this.#tickets.clear();
        ticket = randomUUID();
        this.#tickets.set(input.id, { id: ticket, input, candidate, seal: this.#seal(current, plan) });
      } else this.#tickets.delete(input.id);
      return success({ ticket, ...plan.view });
    } catch (error) {
      this.#tickets.delete(input.id);
      if (this.host.stale(error)) return failure('GIT_STALE');
      return success({ ...asView('Git operation review', 'The active workspace was inspected.').view, ticket: null, blocked: message(error) });
    }
  }

  #seal({ current }: Context, plan: Plan) {
    return digest(current.metadata.worktreeId, current.state.revision, JSON.stringify(plan.view), JSON.stringify(plan.binding));
  }

  apply(request: GitApproved): Promise<Result<GitAdvancedOutcome>> {
    if (!this.host.root(request.id)) return Promise.resolve(failure('ACCESS_DENIED'));
    return this.host.write(async () => {
      const ticket = this.#tickets.get(request.id);
      if (!ticket || ticket.id !== request.ticket) return failure('GIT_STALE');
      this.#tickets.delete(request.id);
      let git: NativeGit | null = null;
      let level: GitAdvancedOutcome['level'] = 'error';
      let detail: string;
      let selection: ProjectSelection | null = null;
      try {
        git = await this.host.git();
        if (!git) throw new GitFailure('The approved Git executable is unavailable.');
        const root = this.host.root(request.id);
        const validate = async () => {
          const context = await this.host.expect(git!, ticket.input);
          if (context.root !== root) throw stale();
          await this.host.noPending(context.root.path);
          if (ticket.candidate.target) await this.host.noPending(ticket.candidate.target.path);
          const planned = await this.#plan(git!, context, ticket.input, ticket.candidate);
          if (!planned.execute || planned.view.blocked || this.#seal(context, planned) !== ticket.seal) throw stale();
          this.host.assertGrant(request.id, context.root);
          return planned;
        };
        const plan = await validate();
        const summary = plan.view.files.slice(0, 24).join('\n');
        const approved = await this.host.confirm(plan.view.title,
          `${root?.path}\n\n${plan.view.detail.slice(0, 3000)}\n\nPlan SHA-256 ${ticket.seal}${summary ? '\n\n' + summary : ''}`,
          'Apply Reviewed Operation');
        if (!approved) {
          detail = 'Git operation cancelled.';
          level = 'cancelled';
        } else {
          const approvedPlan = await validate();
          const result = await approvedPlan.execute!();
          detail = result.message;
          selection = result.selection ?? null;
          level = result.warning ? 'warning' : 'success';
        }
      } catch (error) { detail = message(error); }
      if (this.host.root(request.id)) await this.host.refresh(request.id);
      return success({ status: await this.host.status(git, request.id), message: detail, level, selection });
    });
  }

  async #plan(git: NativeGit, context: Context, input: GitReviewInput, selected: Candidate): Promise<Plan> {
    const { root, current } = context;
    const state = current.state;
    const command = (args: string[]) => git.repo(root.path, args);
    if (input.kind === 'conflict-inspect' || input.kind === 'conflict-stage' || input.kind === 'conflict-reveal') {
      const rows = await conflicts(git, root);
      const path = [...rows.keys()][input.row];
      if (!path) throw stale();
      if (input.kind === 'conflict-reveal') {
        const content = await checkWorktreePath(root, path);
        if (content === 'missing' || !this.host.reveal) throw new GitFailure('There is no working file to reveal.');
        const plan = asView('Reveal conflict file?', 'Show this working file in the file manager so it can be opened in your editor.', [path]);
        plan.binding.push(content);
        plan.execute = async () => {
          if (await checkWorktreePath(root, path) !== content) throw stale();
          this.host.reveal!(join(root.path, ...path.split('/')));
          return { message: 'The working file was revealed in the file manager.' };
        };
        return plan;
      }
      const stages = rows.get(path)!;
      const plan = asView(input.kind === 'conflict-stage' ? 'Stage reviewed conflict resolution?' : 'Inspect conflict',
        `${path}\n${state.operation === 'rebase' ? 'Ours is the upstream and the commits already replayed. Theirs is the original commit being replayed.'
          : 'Ours is the active checkout before the operation. Theirs is the incoming change.'}`, [path]);
      const labels = ['Base', 'Ours', 'Theirs'];
      plan.view.versions = await Promise.all(stages.map(async ({ index, oid }) => ({
        label: labels[index - 1]!, value: patchResult(await git.repo(root.path, ['cat-file', 'blob', oid], patchOptions)),
      })));
      plan.binding.push(...stages.map(({ oid }) => oid));
      if (input.kind === 'conflict-inspect') return plan;
      if (current.hiddenChanges || (state.operation && !['merge', 'rebase', 'cherry-pick'].includes(state.operation))) {
        throw new GitFailure('Resolve this Git state in your external Git client.');
      }
      const hash = await checkWorktreePath(root, path, true);
      plan.binding.push(hash);
      const content = hash === 'missing' ? null : await text(join(root.path, ...path.split('/')), GIT_LIMIT.patch);
      if (content !== null && /^(?:<{7}(?:\s|$)|\|{7}(?:\s|$)|={7}\s*$|>{7}(?:\s|$))/mu.test(content)) {
        throw new GitFailure('Conflict markers remain in the file. Resolve the content in your editor first.');
      }
      plan.view.patch = content === null ? null : patchResult({ bytes: Buffer.from(content), truncated: false });
      plan.view.detail += hash === 'missing' ? '\nStage deletion of the missing file.' : '\nStage the exact reviewed working file.';
      plan.execute = async () => {
        if (await checkWorktreePath(root, path, true) !== hash) throw stale();
        await command(['add', '--', path]);
        return { message: 'Reviewed conflict resolution staged.' };
      };
      return plan;
    }

    if (input.kind === 'worktree-inspect' || input.kind === 'worktree-open' || input.kind === 'worktree-remove') {
      const list = await worktrees(git, context);
      const item = list[input.row];
      const target = selected.target;
      if (!target || !item || pathKey(item.path) !== pathKey(input.path) || pathKey(item.path) !== pathKey(target.path) || item.active || item.missing) throw stale();
      const other = await inspectRepository(git, target);
      if (!('metadata' in other) || other.metadata.repositoryId !== current.metadata.repositoryId) throw stale();
      const files = other.state.changes.map(({ path }) => path);
      const plan = asView(input.kind === 'worktree-remove' ? 'Remove this clean worktree?' : input.kind === 'worktree-open' ? 'Open this worktree?' : 'Inspect registered worktree',
        `${target.path}\n${other.state.branch ?? 'Detached HEAD'} · ${other.state.head ?? 'Unborn HEAD'}\n${files.length ? files.length + ' changed paths' : 'Clean status'}${item.locked ? ' · locked' : ''}${other.state.operation ? ' · ' + other.state.operation : ''}`, files);
      plan.binding.push(JSON.stringify(list), other.state.revision, other.metadata.worktreeId);
      if (input.kind === 'worktree-open') {
        plan.execute = async () => {
          const result = await this.host.adopt(target);
          if (!result.ok) throw new GitFailure('The worktree could not be opened. Close a workspace tab if the tab limit was reached.');
          return { message: 'Worktree opened as a separate workspace.', selection: result.value };
        };
      }
      if (input.kind === 'worktree-remove') {
        if (!this.host.auxiliary(target.path) || item.primary || item.locked || other.state.operation || other.hiddenChanges || files.length
          || (await ignored(git, target)).length) throw new GitFailure('Close the target workspace and preserve all dirty, ignored or locked work before removing it.');
        plan.view.detail += '\nGit removes the reviewed checkout folder and its registration without force. The branch remains.';
        plan.execute = async () => {
          await command(['worktree', 'remove', '--', target.path]);
          return { message: 'Clean worktree removed. Its branch remains available.' };
        };
      }
      return plan;
    }

    if (input.kind === 'continue' || input.kind === 'abort') return this.#recovery(git, context, input.kind);
    if (state.operation || current.hiddenChanges || (await conflicts(git, root)).size) {
      throw new GitFailure('Finish the current Git operation and resolve conflicts before starting another operation.');
    }

    if (input.kind === 'switch' || input.kind === 'worktree-add') {
      const oid = candidateRef(context, input.ref);
      const name = input.ref.slice(11);
      if (name.startsWith('-')) throw new GitFailure('That branch name cannot be used by Studio.');
      const list = await worktrees(git, context);
      const occupied = list.find(({ branch }) => branch === input.ref);
      if (input.kind === 'switch') {
        const head = state.head;
        if (!head || state.branch === name) throw new GitFailure('Select a different branch after the first commit.');
        const paths = await changedPaths(git, root, head, oid);
        const local = state.changes.map(({ path, index, worktree }) => `${index}${worktree} ${path}`);
        const plan = asView('Switch the active worktree?', `Current: ${state.branch ?? 'Detached HEAD'} · ${head}\nTarget: ${input.ref} · ${oid}\n${local.length ? local.length + ' local changes' : 'Clean checkout'}\nThe working directory stays at ${root.path}.`, [...local, ...paths].slice(0, GIT_LIMIT.changes));
        plan.binding.push(JSON.stringify(list));
        if (occupied || local.length) {
          plan.view.blocked = occupied ? `The branch is checked out in ${occupied.path}.` : 'Commit, explicitly stash, or use a separate worktree before switching.';
          return plan;
        }
        await checkoutTree(git, root, oid, true);
        plan.binding.push(...await protectIgnored(git, root, paths));
        plan.execute = async () => {
          await command(['switch', '--no-guess', '--no-overwrite-ignore', '--', name]);
          return { message: 'Branch switched and project refreshed.' };
        };
        return plan;
      }

      const { parent, path } = selected;
      if (!parent || !path || !isLocalGitPath(path) || !this.host.canOpen() || !this.host.auxiliary(path) || list.some((item) => overlaps(pathKey(path), pathKey(item.path)))) {
        throw new GitFailure('Choose an independent destination and make room for a separate workspace tab.');
      }
      await checkedDirectory(parent.path, parent.identity);
      if (await stat(path)) throw new GitFailure('The destination already exists. Choose a new folder.');
      if (input.branch === null && occupied) throw new GitFailure('The requested branch is already checked out. Enter a new branch name.');
      if (input.branch !== null) {
        await git.repo(root.path, ['check-ref-format', 'refs/heads/' + input.branch], readonly);
        if (state.branches.some(({ ref }) => ref.toLowerCase() === ('refs/heads/' + input.branch).toLowerCase())) {
          throw new GitFailure('The new branch name already exists.');
        }
      }
      const entries = await checkoutTree(git, root, oid, false);
      if (entries.length > GIT_LIMIT.changes) throw new GitFailure('There are too many checkout paths to review.');
      const plan = asView('Create worktree in a new folder?',
        `${input.branch === null ? input.ref : 'New branch ' + input.branch + ' from ' + input.ref}\nCommit: ${oid}\nDestination: ${path}`, entries.map(({ path }) => path));
      plan.binding.push(JSON.stringify(list), JSON.stringify(parent.identity));
      plan.execute = async () => {
        await checkedDirectory(parent.path, parent.identity);
        await mkdir(path, { mode: 0o700 });
        const destination = await admitRoot(path);
        if (pathKey(destination.path) !== pathKey(path)) throw stale();
        const args = input.branch === null ? ['--', destination.path, name] : ['--no-track', '-b', input.branch, '--', destination.path, oid];
        await command(['worktree', 'add', ...args]);
        const result = await this.host.adopt(destination);
        return result.ok ? { message: 'Worktree created and opened separately.', selection: result.value }
          : { message: 'Worktree created. Use Open Folder to authorize it.', warning: true };
      };
      return plan;
    }

    if (input.kind === 'branch-delete' || input.kind === 'branch-rename') {
      const oid = candidateRef(context, input.ref);
      const name = input.ref.slice(11);
      const registered = await worktrees(git, context);
      const head = state.head;
      if (!head || !state.branch || name.startsWith('-') || /^(?:main|master)$/iu.test(name)
        || registered.some(({ branch }) => branch === input.ref)) throw new GitFailure('The branch is primary, active, or protected by another checkout.');
      if (input.kind === 'branch-delete') {
        const ancestor = await git.repo(root.path, ['merge-base', '--is-ancestor', oid, head], { ...readonly, accept: [0, 1] });
        if (ancestor.code !== 0) throw new GitFailure('Only branches already merged into the active HEAD may be deleted.');
      } else {
        const next = 'refs/heads/' + input.name;
        await git.repo(root.path, ['check-ref-format', next], readonly);
        if (state.branches.some(({ ref }) => ref.toLowerCase() === next.toLowerCase())) throw new GitFailure('That branch name already exists.');
      }
      const plan = asView(input.kind === 'branch-delete' ? 'Delete merged branch?' : 'Rename inactive local branch?',
        input.kind === 'branch-delete' ? input.ref + ' · ' + oid + '\nVerified merged into ' + state.branch + ' at ' + head
          : input.ref + ' · ' + oid + '\nNew local name: ' + input.name);
      plan.binding.push(JSON.stringify(registered));
      plan.execute = async () => {
        await command(input.kind === 'branch-delete' ? ['branch', '--delete', '--', name] : ['branch', '--move', '--', name, input.name]);
        return { message: input.kind === 'branch-delete' ? 'Merged local branch deleted.' : 'Local branch renamed.' };
      };
      return plan;
    }

    if (input.kind === 'file-replace') {
      clean(context);
      if (!state.head || !safeGitPath(input.path) || /^(?:\.factory\/|\.env(?:\.|$)|\.git)/iu.test(input.path)) {
        throw new GitFailure('Select an ordinary tracked application file.');
      }
      const oid = candidateRef(context, input.ref);
      const before = await checkoutTree(git, root, state.head, true);
      const after = await checkoutTree(git, root, oid, false);
      const currentFile = before.find(({ path }) => path === input.path);
      const incoming = after.find(({ path }) => path === input.path);
      if (!currentFile || !incoming || currentFile.oid === incoming.oid) throw new GitFailure('Select a changed regular file tracked on both sides.');
      const plan = asView('Replace one working file from branch?', `Source: ${input.ref} · ${oid}\nTarget: ${state.branch ?? 'Detached HEAD'} · ${state.head}\nThe replacement remains an unstaged change.`, [input.path]);
      plan.binding.push(...await workspaceAttributes(context, [input.path]), await checkWorktreePath(root, input.path, true));
      plan.view.patch = patchResult(await git.repo(root.path, ['diff', ...patchArgs, state.head, oid, '--', input.path], patchOptions));
      plan.execute = async () => {
        await command(['restore', '--source=' + oid, '--worktree', '--', input.path]);
        return { message: 'Reviewed file placed in the active working tree.' };
      };
      return plan;
    }

    if (input.kind === 'stash-create') {
      if (!state.head) throw new GitFailure('Create an initial commit before stashing.');
      requireAuthor(context);
      const scope = state.changes.flatMap((change, row) => (change.index === '?' && !input.untracked) ? [] : [current.raw[row] ?? null]);
      const paths = assertPaths(scope);
      if (!paths.length) throw new GitFailure('There are no eligible local changes to stash.');
      if (paths.some((path) => /(?:^|\/)(?:\.env(?:\.(?!example$)[^/]*)?$|\.npmrc$|\.netrc$|credentials(?:\.json)?$|id_(?:rsa|ed25519)$)|\.(?:pem|pfx|key)$/iu.test(path))) {
        throw new GitFailure('The selected changes include a path that commonly contains credentials. Keep it out of shared stash history.');
      }
      const tracked = (await checkoutTree(git, root, state.head, true)).map(({ path }) => path);
      const cleanupPaths = [...new Set([...tracked, ...state.changes.filter(({ index }) => index !== '?').map(({ path }) => path)])];
      if (!input.untracked && state.changes.some(({ index, path }) => index === '?'
        && cleanupPaths.some((known) => overlapPath(known.toLowerCase(), path.toLowerCase())))) {
        throw new GitFailure('A tracked path overlaps an untracked file. Save that file before stashing.');
      }
      const attributes = await workspaceAttributes(context, cleanupPaths);
      const protectedPaths = await protectIgnored(git, root, cleanupPaths);
      const before = await stashEntries(git, root);
      if (before.length >= 128) throw new GitFailure('Review and remove a stash before creating another.');
      const plan = asView('Create reviewed stash?', `${input.message}\n${state.branch ?? 'Detached HEAD'} · ${state.head}\n${input.untracked ? 'Tracked and untracked' : 'Tracked only'}. Git saves the reviewed content before restoring tracked files. Included untracked files are removed after saving. Ignored files stay local.`, paths);
      plan.binding.push(JSON.stringify(before), ...attributes, ...protectedPaths, ...await Promise.all(paths.map((path) => checkWorktreePath(root, path, true))));
      plan.execute = async () => {
        // Stash uses its own :/ pathspec to remove saved untracked files.
        // No renderer-supplied pathspec is passed to this command.
        await git.repo(root.path, ['stash', 'push', '--message=' + input.message, ...(input.untracked ? ['--include-untracked'] : [])],
          { nativePathspecs: true });
        const after = await stashEntries(git, root);
        if (!after[0] || after[0].oid === before[0]?.oid) throw new GitFailure('Git did not record a new stash. Refresh to inspect the working tree.');
        const observed = await inspectRepository(git, root);
        if (!('metadata' in observed) || observed.state.changes.some(({ path }) => paths.includes(path))) {
          return { message: 'Git saved a stash. Some reviewed paths may still be present. Inspect before switching.', warning: true };
        }
        return { message: 'Stash created. Its entry is available across linked worktrees.' };
      };
      return plan;
    }

    if (input.kind === 'stash-inspect' || input.kind === 'stash-apply' || input.kind === 'stash-pop' || input.kind === 'stash-drop') {
      const list = await stashEntries(git, root);
      const item = list[input.row];
      if (!item || item.oid !== input.oid) throw stale();
      const entries = await parents(git, root, item.oid);
      const base = entries[0];
      if (!base || entries.length < 2 || entries.length > 3) throw new GitFailure('This stash structure is unsupported.');
      const tracked = await changedPaths(git, root, base, item.oid);
      const staged = await changedPaths(git, root, base, entries[1]!);
      const extra = entries[2] ? (await checkoutTree(git, root, entries[2], false)).map(({ path }) => path) : [];
      const paths = [...new Set([...tracked, ...staged, ...extra])];
      if (paths.length > GIT_LIMIT.changes) throw new GitFailure('The stash exceeds the supported review size.');
      const behavior = { 'stash-inspect': 'Inspect stash', 'stash-apply': 'Apply stash and keep entry?', 'stash-pop': 'Apply stash then drop on success?', 'stash-drop': 'Drop this stash entry?' }[input.kind];
      const plan = asView(behavior, `${item.label}\nStash commit: ${item.oid}\nOriginal base: ${base}\nActive target: ${state.branch ?? 'Detached HEAD'} · ${state.head ?? 'Unborn'}\n${root.path}${base !== state.head ? '\nThis stash was captured at a different commit. Review the target carefully.' : ''}`, paths);
      plan.binding.push(JSON.stringify(list));
      plan.view.patch = patchResult(await git.repo(root.path, ['diff', ...patchArgs, base, item.oid, '--'], patchOptions));
      if (input.kind === 'stash-inspect') return plan;
      if (input.kind !== 'stash-drop') {
        plan.view.detail += '\nStashes are shared across worktrees. Confirm this is the intended checkout.';
        clean(context);
        if (!state.head) throw new GitFailure('Stash application requires a checked-out commit.');
        plan.binding.push(...await reviewedTrees(git, context, [state.head, item.oid, ...entries]));
        plan.binding.push(...await protectIgnored(git, root, paths));
      } else {
        plan.view.detail += '\nDropping removes this shared stash reference. Copy required work elsewhere first.';
      }
      plan.execute = async () => {
        if (input.kind !== 'stash-drop') {
          try { await command(['stash', 'apply', '--index', item.oid]); }
          catch (error) {
            if (!(error instanceof GitCommandFailure)) throw error;
            return { message: 'Git could not finish applying this stash. The stash entry was kept. Review the working tree and any conflicts.', warning: true };
          }
          if (input.kind === 'stash-apply') return { message: 'Stash applied with its index and kept in history.' };
        }
        if (JSON.stringify(await stashEntries(git, root)) !== JSON.stringify(list)) {
          return { message: 'Shared stash history changed. No entry was dropped.', warning: true };
        }
        await command(['stash', 'drop', 'stash@{' + input.row + '}']);
        return { message: input.kind === 'stash-pop' ? 'Stash applied with its index and dropped.' : 'Reviewed stash entry dropped.' };
      };
      return plan;
    }

    if (input.kind !== 'merge' && input.kind !== 'rebase' && input.kind !== 'cherry-pick') throw stale();
    clean(context);
    requireAuthor(context);
    const { head, branch } = state;
    if (!head || !branch) throw new GitFailure('Check out a named branch after the first commit.');
    const source = candidateRef(context, input.source);
    const sourceParents = await parents(git, root, source);
    if (source === head) throw new GitFailure('Select a source commit different from the active HEAD.');
    const bases = await git.repo(root.path, ['merge-base', '--all', head, source], { ...readonly, accept: [0, 1], limit: 4096 });
    const base = words(bases.bytes).trim();
    if (!isGitOid(base)) throw new GitFailure('This history has no single reviewed common ancestor.');
    const history = input.kind === 'cherry-pick' ? [source]
      : input.kind === 'rebase' ? await commits(git, root, head, source) : await commits(git, root, source, head);
    if (!history.length) throw new GitFailure('There are no commits to apply in the selected direction.');
    if (input.kind === 'merge' && input.strategy === 'ff-only' && base !== head) throw new GitFailure('The selected histories diverged. To integrate them, review the merge commit strategy.');
    if (input.kind === 'cherry-pick' && sourceParents.length !== 1) throw new GitFailure('Select one ordinary, non-merge commit.');
    if (input.kind === 'rebase') {
      const publishable = state.upstream && !state.branches.some(({ ref }) => ref === 'refs/remotes/' + state.upstream || ref === 'refs/heads/' + state.upstream);
      const unpublished = await commits(git, root, head, source, true);
      if (publishable || unpublished.length !== history.length) throw new GitFailure('Rebase is blocked because commits may already be published or the upstream is not available locally.');
      for (const oid of history) if ((await parents(git, root, oid)).length !== 1) throw new GitFailure('Rebase supports a linear unpublished commit range.');
    }
    const integrationBase = input.kind === 'cherry-pick' ? sourceParents[0]! : base;
    const paths = new Set(await changedPaths(git, root, integrationBase, source));
    if (input.kind !== 'cherry-pick') for (const path of await changedPaths(git, root, base, head)) paths.add(path);
    if (input.kind === 'rebase') {
      for (const oid of history) for (const path of await changedPaths(git, root, (await parents(git, root, oid))[0]!, oid)) paths.add(path);
    }
    if (paths.size > GIT_LIMIT.changes) throw new GitFailure('The operation affects too many paths to review.');
    const attrs = await reviewedTrees(git, context, [head, source, integrationBase, ...(input.kind === 'rebase' ? history : [])]);
    const hidden = await protectIgnored(git, root, [...paths]);
    const summaries = await Promise.all(history.map(async (oid) => {
      const summary = await git.repo(root.path, ['show', '-s', '--format=%h %s', oid, '--'], { ...patchOptions, limit: 512 });
      return patchResult(summary).text.replace(/\n/gu, ' ').trim();
    }));
    const strategy = input.kind === 'merge' ? (input.strategy === 'ff-only' ? 'Fast-forward only' : 'Merge commit')
      : input.kind === 'rebase' ? 'Replay unpublished commits, rewriting their IDs' : 'Apply one commit';
    const plan = asView(`Review ${input.kind}?`, `Source: ${input.source} · ${source}\nTarget workspace: ${root.path}\nActive: ${branch} · ${head}\nCommon base: ${base} · ${base === head ? 'fast-forward possible' : base === source ? 'source behind' : 'diverged'}\nClean working tree · ${strategy}\n\n${summaries.join('\n')}`, [...paths].sort());
    plan.binding.push(source, ...history, ...hidden, ...attrs);
    plan.view.patch = patchResult(await git.repo(root.path, ['diff', ...patchArgs, integrationBase, input.kind === 'rebase' ? head : source, '--'], patchOptions));
    const operation: Recovery = { kind: input.kind, branch, head, source, commits: history, paths: [...paths] };
    plan.execute = async () => {
      await this.recoveries.save(current.metadata.worktreeId, operation);
      try {
        if (input.kind === 'merge') {
          await command(['merge', input.strategy === 'ff-only' ? '--ff-only' : '--no-ff', '--no-edit', '--no-gpg-sign', '--no-overwrite-ignore', '--no-autostash', '--strategy=ort', source, '--']);
        } else if (input.kind === 'rebase') {
          await command(['rebase', '--merge', '--no-autostash', '--no-update-refs', '--no-fork-point', '--no-rebase-merges', '--no-gpg-sign', source]);
        } else {
          await command(['cherry-pick', '--no-gpg-sign', '--no-rerere-autoupdate', source]);
        }
        await this.recoveries.remove(current.metadata.worktreeId);
        return { message: 'Reviewed Git operation completed.' };
      } catch (error) {
        const observed = await this.host.status(git, input.id);
        if (observed.state === 'repository' && observed.operation === input.kind && observed.worktreeId === current.metadata.worktreeId) {
          return { message: 'Git paused the reviewed operation. Inspect conflicts and use Continue or Abort after reviewing the active worktree.', warning: true };
        }
        if (observed.state === 'repository' && observed.operation === null) await this.recoveries.remove(current.metadata.worktreeId);
        throw error;
      }
    };
    return plan;
  }

  async #recovery(git: NativeGit, context: Context, action: 'continue' | 'abort'): Promise<Plan> {
    const { root, current } = context;
    const { state, metadata } = current;
    const checkpoint = await this.recoveries.read(metadata.worktreeId);
    if (!checkpoint || state.operation !== checkpoint.kind) {
      throw new GitFailure('This operation has no active Studio review. Inspect it and use the original Git client for recovery.');
    }
    if (current.hiddenChanges || (action === 'continue' && (await conflicts(git, root)).size)) {
      throw new GitFailure('Resolve and stage all conflicts before continuing.');
    }
    const paths = assertPaths(current.raw);
    if (state.changes.some((change) => change.index === '?' || (action === 'continue' && change.worktree !== '.'))
      || paths.some((path) => !checkpoint.paths.includes(path))) {
      throw new GitFailure('Save unrelated, untracked or unstaged work before recovery.');
    }
    const get = async (path: string) => (await text(join(metadata.directory, path)))?.trim() ?? '';
    const binding: string[] = [];
    if (checkpoint.kind === 'rebase') {
      const [original, target, branch, todo, done, rebaseHead] = await Promise.all([
        get('rebase-merge/orig-head'), get('rebase-merge/onto'), get('rebase-merge/head-name'),
        get('rebase-merge/git-rebase-todo'), get('rebase-merge/done'), get('REBASE_HEAD'),
      ]);
      if (original !== checkpoint.head || target !== checkpoint.source || branch !== 'refs/heads/' + checkpoint.branch || state.branch !== null
        || state.branches.find(({ ref }) => ref === branch)?.oid !== original
        || (rebaseHead && !checkpoint.commits.includes(rebaseHead))) throw stale();
      const nativeEntries = new Set(['author-script', 'done', 'drop_redundant_commits', 'end', 'git-rebase-todo',
        'git-rebase-todo.backup', 'head-name', 'interactive', 'message', 'msgnum', 'no-reschedule-failed-exec',
        'onto', 'orig-head', 'patch', 'stopped-sha', 'quiet', 'verbose']);
      const entries = await readdir(join(metadata.directory, 'rebase-merge'));
      if (entries.some((name) => !nativeEntries.has(name)) || await stat(join(metadata.directory, 'rebase-apply'))) throw stale();
      binding.push(...entries);
      const seen = new Set<string>();
      for (const line of (todo + '\n' + done).split('\n')) {
        if (!line || line.startsWith('#')) continue;
        const match = /^pick ([a-f0-9]{7,64})(?: |$)/u.exec(line);
        if (!match) throw stale();
        const matching = checkpoint.commits.filter((oid) => oid.startsWith(match[1]!));
        if (matching.length !== 1 || seen.has(matching[0]!)) throw stale();
        seen.add(matching[0]!);
      }
      binding.push(todo, done, rebaseHead);
    } else {
      const marker = checkpoint.kind === 'merge' ? 'MERGE_HEAD' : 'CHERRY_PICK_HEAD';
      const source = await get(marker);
      if (source !== checkpoint.source || state.head !== checkpoint.head || state.branch !== checkpoint.branch
        || await stat(join(metadata.directory, 'sequencer')) || await stat(join(metadata.directory, 'MERGE_AUTOSTASH'))
        || (checkpoint.kind === 'merge' && await get('ORIG_HEAD') !== checkpoint.head)) throw stale();
      binding.push(source);
    }
    binding.push(...await protectIgnored(git, root, checkpoint.paths), ...await workspaceAttributes(context, checkpoint.paths));
    const plan = asView(`${action === 'continue' ? 'Continue' : 'Abort'} ${checkpoint.kind}?`,
      `Reviewed target: ${checkpoint.branch}\nBefore operation: ${checkpoint.head}\nSource: ${checkpoint.source}\n${action === 'abort'
        ? 'Git will restore the pre-operation checkout. Reviewed conflict edits may be discarded. Save copies of edits you want to keep.'
        : 'Git will use the reviewed staged conflict resolutions.'}`, paths);
    plan.binding.push(...binding, ...await Promise.all(paths.map((path) => checkWorktreePath(root, path, true))));
    plan.execute = async () => {
      try {
        await git.repo(root.path, [checkpoint.kind, '--' + action]);
        await this.recoveries.remove(metadata.worktreeId);
        return { message: action === 'abort' ? 'Git aborted the reviewed operation.' : 'Git continued the reviewed operation.' };
      } catch (error) {
        const live = await inspectRepository(git, root);
        if ('metadata' in live && live.state.operation === checkpoint.kind) {
          return { message: 'Git is still paused. Refresh and inspect the operation before trying again.', warning: true };
        }
        throw error;
      }
    };
    return plan;
  }
}
