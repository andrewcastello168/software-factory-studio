import { createHash } from 'node:crypto';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GIT_LIMIT, hasControlCharacters, isGitOid, isGitRef, isGitRemoteName, isProjectSegment, PROJECT_LIMITS } from '@factory/contracts';
import type { GitBranch, GitChange, GitRepository, GitState } from '@factory/contracts';
import { checkedDirectory, directoryIdentity, pathKey, readBoundedFile, withDirectory } from '../projects/filesystem';
import type { ProjectRoot } from '../projects/filesystem';
import { GitFailure } from './process';
import type { NativeGit } from './process';

export class RestrictedRepository extends GitFailure {}

export const pathIsMissing = (error: unknown) =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

async function fileStat(path: string) {
  try {
    return await lstat(path, { bigint: true });
  } catch (error) {
    if (pathIsMissing(error)) return null;
    throw error;
  }
}

export function digest(...values: (string | Buffer)[]): string {
  const hash = createHash('sha256');
  for (const value of values) hash.update(String(Buffer.byteLength(value))).update(':').update(value);
  return hash.digest('hex');
}

export function safeGitPath(path: string): boolean {
  return path.length <= PROJECT_LIMITS.relativePath && path.normalize('NFC') === path
    && !/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069\uFFFD]/u.test(path)
    && path.split('/').every((part) => isProjectSegment(part) && !/^\.git$|^git~\d+$/iu.test(part));
}

function displayPath(path: string) {
  if (safeGitPath(path)) return path;
  return path.replace(/[\p{Cc}\p{Cf}]/gu, (character) => JSON.stringify(character).slice(1, -1)
    .replace(character, `\\u${character.codePointAt(0)!.toString(16).padStart(4, '0')}`)).slice(0, 4096);
}

export function publicHttps(value: string): string | null {
  if (!/^https:\/\/[A-Za-z0-9.[\]:-]+\/[a-zA-Z0-9/_.~-]+$/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password
      && !url.search && !url.hash && url.pathname !== '/' ? url.href : null;
  } catch {
    return null;
  }
}

export function localRemotePath(value: string): string | null {
  if (hasControlCharacters(value)) return null;
  try {
    if (value.startsWith('file://')) {
      const url = new URL(value);
      if (url.host || url.search || url.hash || url.username || url.password) return null;
      return fileURLToPath(url);
    }
    return isAbsolute(value) && !value.startsWith('\\\\') && !value.startsWith('//') ? value : null;
  } catch {
    return null;
  }
}

export interface RemoteConfig {
  name: string;
  value: string;
  kind: 'https' | 'local' | 'unsupported';
}

interface RepositoryConfig {
  hash: string;
  remotes: RemoteConfig[];
  entries: Map<string, string>;
}

const safeCore = new Set([
  'core.repositoryformatversion', 'core.filemode', 'core.bare', 'core.logallrefupdates', 'core.ignorecase', 'core.symlinks',
  'core.autocrlf', 'core.safecrlf', 'core.eol', 'core.precomposeunicode', 'core.longpaths', 'core.quotepath',
  'core.protectntfs', 'core.protecthfs',
]);

/** Verify the physical metadata tree before allowing Git to parse repository configuration. */
async function auditMetadata(root: ProjectRoot, metadata: string) {
  await checkedDirectory(root.path, root.identity);
  const top = await checkedDirectory(metadata);
  let seen = 0;
  const pending = [metadata];
  while (pending.length) {
    const directory = pending.pop()!;
    const identity = directoryIdentity(await checkedDirectory(directory));
    const entries = await withDirectory(directory, identity, (opened) => readdir(opened));
    seen += entries.length;
    if (seen > 25_000 || directory.length > metadata.length + 4096) {
      throw new RestrictedRepository('Git metadata exceeds the supported inspection limits.');
    }
    for (const name of entries) {
      const path = join(directory, name);
      const stat = await fileStat(path);
      if (!stat) continue;
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()) || pathKey(await realpath(path)) !== pathKey(path)) {
        throw new RestrictedRepository('Git metadata contains a link, junction, or unsupported filesystem entry.');
      }
      if (stat.isDirectory()) pending.push(path);
    }
  }
  for (const relative of ['objects/info/alternates', 'objects/info/http-alternates', 'info/grafts', 'commondir']) {
    if (await fileStat(join(metadata, relative))) {
      throw new RestrictedRepository('Git object alternates, grafts, or external common directories are outside the Phase 03 boundary.');
    }
  }
  for (const name of ['worktrees', 'modules']) {
    const path = join(metadata, name);
    if ((await fileStat(path))?.isDirectory() && (await readdir(path)).length) {
      throw new RestrictedRepository('Registered linked worktrees and submodules require the advanced Git workspace policy.');
    }
  }
  await checkedDirectory(metadata, directoryIdentity(top));
  await checkedDirectory(root.path, root.identity);
  return directoryIdentity(top);
}

export async function repositoryConfig(git: NativeGit, root: ProjectRoot, bare = false): Promise<RepositoryConfig> {
  const metadata = bare ? root.path : join(root.path, '.git');
  const identity = await auditMetadata(root, metadata);
  const configPath = join(metadata, 'config');
  const stat = await fileStat(configPath);
  if (!stat) throw new RestrictedRepository('Git configuration is missing.');
  const initial = await readBoundedFile(configPath, stat, 65_536, (bytes) => digest(bytes));
  const output = await git.run(git.scratch, ['config', '--file', configPath, '--no-includes', '--null', '--list'], { readOnly: true, limit: 100_000 });
  await checkedDirectory(metadata, identity);
  const current = await fileStat(configPath);
  if (!current || initial !== await readBoundedFile(configPath, current, 65_536, (bytes) => digest(bytes))) {
    throw new RestrictedRepository('Git configuration changed during review. Refresh the repository.');
  }
  const entries = new Map<string, string>();
  const urls: RemoteConfig[] = [];
  for (const record of output.bytes.toString('utf8').split('\0').filter(Boolean)) {
    const newline = record.indexOf('\n');
    const key = newline < 0 ? record : record.slice(0, newline);
    const value = newline < 0 ? '' : record.slice(newline + 1);
    const remote = /^remote\.(.+)\.(url|fetch)$/u.exec(key);
    const branch = /^branch\.(.+)\.(remote|merge)$/u.exec(key);
    if (entries.has(key) || value.includes('\uFFFD') || hasControlCharacters(value)) {
      throw new RestrictedRepository('Git configuration uses duplicate values or unsupported encoding.');
    }
    if (remote && isGitRemoteName(remote[1])) {
      if (remote[2] === 'url') {
        const kind = publicHttps(value) ? 'https' : localRemotePath(value) ? 'local' : 'unsupported';
        urls.push({ name: remote[1], kind, value });
      } else if (value !== `+refs/heads/*:refs/remotes/${remote[1]}/*` && value !== `refs/heads/*:refs/remotes/${remote[1]}/*`) {
        throw new RestrictedRepository('This remote uses a custom fetch mapping outside the Phase 03 policy.');
      }
    } else if (branch && isGitRef(`refs/heads/${branch[1]}`)) {
      if (branch[2] === 'merge' ? !isGitRef(value) || !value.startsWith('refs/heads/')
        : value !== '.' && !isGitRemoteName(value)) {
        throw new RestrictedRepository('Git upstream configuration is unsupported.');
      }
    } else if (!(safeCore.has(key) || key === 'user.name' || key === 'user.email'
      || (key === 'extensions.objectformat' && (value === 'sha1' || value === 'sha256')))) {
      throw new RestrictedRepository('Git configuration contains settings outside the safe execution policy. Open this repository in your Git client to review its configuration.');
    }
    entries.set(key, value);
  }
  if ((entries.get('core.bare') === 'true') !== bare
    || (bare && (!(await fileStat(join(metadata, 'HEAD')))?.isFile() || !(await fileStat(join(metadata, 'objects')))?.isDirectory()))) {
    throw new RestrictedRepository(bare ? 'Select a bare Git repository for local transport.' : 'Open a standalone Git working folder.');
  }
  if (urls.length > GIT_LIMIT.remotes) throw new RestrictedRepository('This repository exceeds the supported remote count.');
  return { hash: digest(initial, JSON.stringify(identity)), entries, remotes: urls };
}

function readStatus(bytes: Buffer) {
  const records = bytes.toString('utf8').split('\0');
  const headers = new Map<string, string>();
  const changes: GitChange[] = [];
  const raw: (string[] | null)[] = [];
  for (let cursor = 0; cursor < records.length; cursor++) {
    const line = records[cursor] ?? '';
    if (!line) continue;
    if (line.startsWith('# ')) {
      const separator = line.indexOf(' ', 2);
      if (separator !== -1) headers.set(line.slice(2, separator), line.slice(separator + 1));
      continue;
    }
    const type = line[0];
    let path: string;
    let original: string | null = null;
    let index = '?';
    let worktree = '?';
    if (type === '?' && line.startsWith('? ')) {
      path = line.slice(2);
    } else {
      const separators = type === '1' ? 8 : type === '2' ? 9 : type === 'u' ? 10 : 0;
      if (!separators || !/^[12u] [.MADRCUT]{2} /u.test(line)) throw new GitFailure('Git returned an unsupported status record.');
      let end = 0;
      for (let n = 0; n < separators; n++) {
        end = line.indexOf(' ', end + 1);
        if (end < 0) throw new GitFailure('Git returned an invalid status record.');
      }
      path = line.slice(end + 1);
      [index, worktree] = [line[2]!, line[3]!];
      if (type === '2') original = records[++cursor] ?? '';
    }
    const paths = original === null ? [path] : [path, original];
    const representable = paths.every(safeGitPath);
    raw.push(representable ? paths : null);
    changes.push({
      path: displayPath(path), original: original === null ? null : displayPath(original),
      index, worktree, actionable: representable && type !== 'u',
    });
    if (changes.length > GIT_LIMIT.changes) throw new GitFailure('The repository has too many changes to review safely in Studio.');
  }
  return { headers, changes, raw };
}

async function operationState(metadata: string): Promise<GitRepository['operation']> {
  for (const [path, kind] of [
    ['MERGE_HEAD', 'merge'], ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'],
    ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'], ['BISECT_START', 'bisect'], ['sequencer', 'sequencer'],
  ] as const) {
    if (await fileStat(join(metadata, path))) return kind;
  }
  return null;
}

export interface RepositorySnapshot {
  state: GitRepository;
  raw: (string[] | null)[];
  config: RepositoryConfig;
  hiddenChanges: boolean;
}

export async function inspectRepository(git: NativeGit, root: ProjectRoot): Promise<RepositorySnapshot | Exclude<GitState, { state: 'repository' }>> {
  const marker = join(root.path, '.git');
  const info = await fileStat(marker);
  if (!info) {
    let child = root.path;
    while (child !== dirname(child)) {
      const parent = dirname(child);
      const enclosingMarker = join(parent, '.git');
      const enclosing = await fileStat(enclosingMarker);
      if (enclosing && (!enclosing.isDirectory() || await fileStat(join(enclosingMarker, 'HEAD')))) {
        return { state: 'unsupported', detail: 'This folder is inside a Git repository. Use Open Folder to admit the repository root for Git Studio.' };
      }
      child = parent;
    }
    const bare = (await fileStat(join(root.path, 'HEAD')))?.isFile() && (await fileStat(join(root.path, 'objects')))?.isDirectory();
    return bare ? { state: 'unsupported', detail: 'Open a Git working folder to use source control. Bare repositories are supported as local remotes.' }
      : { state: 'not-repository', detail: 'This folder has no Git repository.' };
  }
  if (!info.isDirectory()) {
    throw new RestrictedRepository('This Git marker is a link or pointer to external metadata. Open a standalone repository.');
  }
  const config = await repositoryConfig(git, root);
  const options = { readOnly: true };
  const [status, refs, index, operation] = await Promise.all([
    git.repo(root.path, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--ignore-submodules=all', '--renames'], options),
    git.repo(root.path, ['for-each-ref', '--format=%(refname)%09%(objectname)%09%(symref)', 'refs/heads/', 'refs/remotes/'], options),
    git.repo(root.path, ['ls-files', '-v', '--stage', '-z'], options),
    operationState(marker),
  ]);
  const indexEntries = index.bytes.toString('utf8').split('\0');
  if (indexEntries.some((record) => /^[A-Za-z] 160000 /u.test(record))) {
    throw new RestrictedRepository('Tracked submodules are outside the Phase 03 Git boundary.');
  }
  const parsed = readStatus(status.bytes);
  const branches: GitBranch[] = [];
  for (const line of refs.bytes.toString('utf8').split('\n').filter(Boolean)) {
    const [ref, oid, symref] = line.split('\t');
    if (symref) continue;
    if (!isGitRef(ref) || !isGitOid(oid)) {
      throw new RestrictedRepository('A branch uses a name or object identifier Studio cannot represent safely.');
    }
    branches.push({ ref, oid });
  }
  if (branches.length > GIT_LIMIT.branches) throw new RestrictedRepository('This repository exceeds the supported branch count.');
  const head = parsed.headers.get('branch.oid');
  const branch = parsed.headers.get('branch.head');
  if (!(isGitOid(head) || head === '(initial)') || !branch || (branch !== '(detached)' && !isGitRef(`refs/heads/${branch}`))) {
    throw new GitFailure('Git could not establish the repository branch and HEAD.');
  }
  const upstreamRemote = config.entries.get(`branch.${branch}.remote`);
  const upstreamMerge = config.entries.get(`branch.${branch}.merge`);
  const tracking = parsed.headers.get('branch.upstream');
  const upstream = tracking ?? (isGitRemoteName(upstreamRemote) && upstreamMerge ? `${upstreamRemote}/${upstreamMerge.slice(11)}` : null);
  const ab = (/^\+(\d+) -(\d+)$/u).exec(parsed.headers.get('branch.ab') ?? '');
  const indexStat = await fileStat(join(marker, 'index'));
  const indexHash = indexStat
    ? await readBoundedFile(join(marker, 'index'), indexStat, 8_000_000, (contents) => digest(contents)) : '';
  await checkedDirectory(root.path, root.identity);
  // Git's XY status stays unchanged when a dirty file is edited again.
  // Include filesystem identities so an older diff or row review goes stale.
  const stamps: string[] = [];
  for (const [index, change] of parsed.changes.entries()) {
    const paths = parsed.raw[index];
    if (change.worktree === '.' || !paths) continue;
    for (const path of paths) {
      try {
        stamps.push(await checkWorktreePath(root, path));
      } catch {
        change.actionable = false;
        stamps.push('blocked');
      }
    }
  }
  const state: GitRepository = {
    state: 'repository',
    root: root.path,
    revision: digest(config.hash, status.bytes, refs.bytes, indexHash, operation ?? '', JSON.stringify(stamps)),
    branch: branch === '(detached)' ? null : branch,
    head: head === '(initial)' ? null : head,
    upstream,
    upstreamRemote: isGitRemoteName(upstreamRemote) ? upstreamRemote : null,
    ahead: ab ? Number(ab[1]) : null,
    behind: ab ? Number(ab[2]) : null,
    operation,
    changes: parsed.changes,
    branches,
    remotes: config.remotes.map(({ name, kind }) => ({ name, kind })),
  };
  const hiddenChanges = indexEntries.some((record) => /^[Sa-z] /u.test(record));
  return { state, raw: parsed.raw, config, hiddenChanges };
}

export async function checkWorktreePath(root: ProjectRoot, path: string, fingerprint = false): Promise<string> {
  if (!safeGitPath(path)) throw new GitFailure('This file name cannot be used safely in a Git operation.');
  await checkedDirectory(root.path, root.identity);
  const parts = path.split('/');
  let absolute = root.path;
  for (const [index, part] of parts.entries()) {
    absolute = join(absolute, part);
    const info = await fileStat(absolute);
    if (!info) return 'missing';
    const leaf = index === parts.length - 1;
    if (pathKey(await realpath(absolute)) !== pathKey(absolute) || (leaf ? !info.isFile() : !info.isDirectory())) {
      throw new GitFailure('Studio blocked a linked path or a filesystem entry that is not a regular file.');
    }
    if (leaf) {
      return fingerprint
        ? readBoundedFile(absolute, info, 32_000_000, (contents) => digest(contents))
        : [info.dev, info.ino, info.mtimeNs, info.ctimeNs, info.size].join(':');
    }
  }
  return '';
}

/** Checkout only ordinary tree entries with portable paths. Never materialize links or gitlinks. */
export async function checkoutTree(git: NativeGit, root: ProjectRoot, oid: string, checkExisting: boolean) {
  const output = await git.repo(root.path, ['ls-tree', '-r', '-z', oid], { readOnly: true, limit: 4_000_000 });
  const names = new Map<string, string>();
  const parents = new Set<string>();
  const files = new Set<string>();
  for (const line of output.bytes.toString('utf8').split('\0').filter(Boolean)) {
    const entry = /^(100644|100755) blob [a-f0-9]+\t(.+)$/u.exec(line);
    const path = entry?.[2];
    if (!path || !safeGitPath(path)) {
      throw new GitFailure('The target contains links, submodules, or paths Studio cannot safely check out.');
    }
    files.add(path);
    const parts = path.split('/');
    let prefix = '';
    for (const part of parts) {
      prefix += (prefix ? '/' : '') + part;
      const key = prefix.toLowerCase();
      const earlier = names.get(key);
      if (earlier && earlier !== prefix) throw new GitFailure('The target contains paths that collide on case-insensitive filesystems.');
      names.set(key, prefix);
      if (prefix !== path) parents.add(prefix);
    }
    if (checkExisting) await checkWorktreePath(root, path);
  }
  // Nonsensical trees can contain a file in the same position as a directory.
  if ([...parents].some((parent) => files.has(parent))) {
    throw new GitFailure('The target contains a conflicting file and directory.');
  }
}
