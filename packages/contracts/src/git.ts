import type { ProjectSelection, Result } from './index';
import { isProjectId, isProjectSegment, isProjectSelection, PROJECT_LIMITS } from './projects';
import { hasControlCharacters, hasExactKeys, isRecord } from './validation';

export const GIT_CHANNEL = {
  status: 'factory:git-status',
  diff: 'factory:git-diff',
  compare: 'factory:git-compare',
  action: 'factory:git-action',
  clone: 'factory:git-clone',
} as const;

export const GIT_LIMIT = { changes: 4000, branches: 2000, remotes: 64, patch: 240_000 } as const;
export type GitArea = 'working' | 'staged';

export interface GitChange {
  path: string;
  original: string | null;
  index: string;
  worktree: string;
  actionable: boolean;
}

export interface GitBranch {
  ref: string;
  oid: string;
}

export interface GitRemote {
  name: string;
  kind: 'https' | 'local' | 'unsupported';
}

export interface GitRepository {
  state: 'repository';
  revision: string;
  root: string;
  branch: string | null;
  head: string | null;
  upstream: string | null;
  upstreamRemote: string | null;
  ahead: number | null;
  behind: number | null;
  operation: 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect' | 'sequencer' | null;
  changes: GitChange[];
  branches: GitBranch[];
  remotes: GitRemote[];
}

export type GitState = GitRepository
  | { state: 'unavailable' | 'not-repository' | 'missing' | 'unsupported' | 'failed'; detail: string };

export interface GitDiff {
  text: string;
  truncated: boolean;
}

export interface GitDiffRequest {
  id: string;
  revision: string;
  row: number;
  area: GitArea;
}

export interface GitCompareRequest {
  id: string;
  revision: string;
  ref: string;
}

export type GitActionInput =
  | { operation: 'init' | 'pull' | 'push' }
  | { operation: 'stage' | 'unstage'; row: number }
  | { operation: 'commit'; message: string }
  | { operation: 'create'; name: string }
  | { operation: 'switch'; ref: string }
  | { operation: 'fetch'; remote: string };

export type GitAction = { id: string; revision: string | null } & GitActionInput;

export interface GitOutcome {
  status: GitState;
  message: string;
  level: 'success' | 'warning' | 'error' | 'cancelled';
}

export type GitCloneRequest =
  | { source: 'https'; url: string; name: string }
  | { source: 'local'; name: string };

export interface GitCloneResult {
  selection: ProjectSelection | null;
  message: string;
  level: GitOutcome['level'];
}

export interface GitBridge {
  status(id: string): Promise<Result<GitState>>;
  diff(request: GitDiffRequest): Promise<Result<GitDiff>>;
  compare(request: GitCompareRequest): Promise<Result<GitDiff>>;
  action(request: GitAction): Promise<Result<GitOutcome>>;
  clone(request: GitCloneRequest): Promise<Result<GitCloneResult>>;
}

function bounded(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}

function optional(value: unknown, max: number): boolean {
  return value === null || bounded(value, max);
}

export function isGitOid(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value);
}

function isRevision(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

export function isGitRemoteName(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/u.test(value)
    && !value.endsWith('.') && !value.includes('..') && !value.endsWith('.lock');
}

export function isGitRef(value: unknown): value is string {
  return bounded(value, 1024) && /^refs\/(?:heads|remotes)\//u.test(value)
    && !/[\s~^:?*\x5b\\]/u.test(value) && !hasControlCharacters(value)
    && !/[\p{Cf}\uFFFD]/u.test(value) && value.normalize('NFC') === value
    && !value.includes('..') && !value.includes('@{')
    && value.split('/').every((part) => part && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'));
}

function row(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < GIT_LIMIT.changes;
}

export function isGitDiffRequest(value: unknown): value is GitDiffRequest {
  return isRecord(value) && hasExactKeys(value, ['id', 'revision', 'row', 'area'])
    && isProjectId(value.id) && isRevision(value.revision) && row(value.row)
    && (value.area === 'working' || value.area === 'staged');
}

export function isGitCompareRequest(value: unknown): value is GitCompareRequest {
  return isRecord(value) && hasExactKeys(value, ['id', 'revision', 'ref'])
    && isProjectId(value.id) && isRevision(value.revision) && isGitRef(value.ref);
}

export function isGitAction(value: unknown): value is GitAction {
  if (!isRecord(value) || !isProjectId(value.id)) return false;
  const keys = ['id', 'revision', 'operation'];
  if (value.operation === 'init') return value.revision === null && hasExactKeys(value, keys);
  if (!isRevision(value.revision)) return false;
  switch (value.operation) {
    case 'pull':
    case 'push': return hasExactKeys(value, keys);
    case 'stage':
    case 'unstage': return hasExactKeys(value, [...keys, 'row']) && row(value.row);
    case 'commit': return hasExactKeys(value, [...keys, 'message']) && bounded(value.message, 8000)
      && value.message.trim().length > 0 && !hasControlCharacters(value.message.replace(/[\n\t\r]/gu, ''));
    case 'create': return hasExactKeys(value, [...keys, 'name']) && bounded(value.name, 240)
      && !value.name.startsWith('-') && isGitRef(`refs/heads/${value.name}`);
    case 'switch': return hasExactKeys(value, [...keys, 'ref']) && isGitRef(value.ref) && value.ref.startsWith('refs/heads/');
    case 'fetch': return hasExactKeys(value, [...keys, 'remote']) && isGitRemoteName(value.remote);
    default: return false;
  }
}

export function isGitCloneRequest(value: unknown): value is GitCloneRequest {
  if (!isRecord(value) || !bounded(value.name, 120) || !isProjectSegment(value.name)
    || value.name.startsWith('.') || !/^[\p{L}\p{N} _.-]+$/u.test(value.name)) return false;
  return value.source === 'local' ? hasExactKeys(value, ['source', 'name'])
    : value.source === 'https' && hasExactKeys(value, ['source', 'name', 'url']) && bounded(value.url, 2048)
      && !hasControlCharacters(value.url);
}

function isChange(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ['path', 'original', 'index', 'worktree', 'actionable'])
    && bounded(value.path, 4096) && optional(value.original, 4096)
    && typeof value.index === 'string' && /^[.MADRCUT?]$/u.test(value.index)
    && typeof value.worktree === 'string' && /^[.MADRCUT?]$/u.test(value.worktree)
    && typeof value.actionable === 'boolean';
}

function isBranch(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ['ref', 'oid']) && isGitRef(value.ref) && isGitOid(value.oid);
}

function isRemote(value: unknown): boolean {
  return isRecord(value) && hasExactKeys(value, ['name', 'kind']) && isGitRemoteName(value.name)
    && (value.kind === 'https' || value.kind === 'local' || value.kind === 'unsupported');
}

function count(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function isGitState(value: unknown): value is GitState {
  if (!isRecord(value)) return false;
  if (value.state !== 'repository') {
    return hasExactKeys(value, ['state', 'detail']) && bounded(value.detail, 500)
      && ['unavailable', 'not-repository', 'missing', 'unsupported', 'failed'].some((state) => value.state === state);
  }
  return hasExactKeys(value, ['state', 'revision', 'root', 'branch', 'head', 'upstream', 'upstreamRemote',
    'ahead', 'behind', 'operation', 'changes', 'branches', 'remotes'])
    && isRevision(value.revision) && bounded(value.root, PROJECT_LIMITS.absolutePath)
    && optional(value.branch, 1024) && (value.head === null || isGitOid(value.head))
    && optional(value.upstream, 1024) && (value.upstreamRemote === null || isGitRemoteName(value.upstreamRemote))
    && ((value.ahead === null && value.behind === null) || (count(value.ahead) && count(value.behind)))
    && [null, 'merge', 'rebase', 'cherry-pick', 'revert', 'bisect', 'sequencer'].some((item) => item === value.operation)
    && Array.isArray(value.changes) && value.changes.length <= GIT_LIMIT.changes && value.changes.every(isChange)
    && Array.isArray(value.branches) && value.branches.length <= GIT_LIMIT.branches && value.branches.every(isBranch)
    && Array.isArray(value.remotes) && value.remotes.length <= GIT_LIMIT.remotes && value.remotes.every(isRemote);
}

export function isGitDiff(value: unknown): value is GitDiff {
  return isRecord(value) && hasExactKeys(value, ['text', 'truncated']) && typeof value.text === 'string'
    && value.text.length <= GIT_LIMIT.patch && !value.text.includes('\0') && typeof value.truncated === 'boolean';
}

function level(value: unknown): boolean {
  return value === 'success' || value === 'warning' || value === 'error' || value === 'cancelled';
}

export function isGitOutcome(value: unknown): value is GitOutcome {
  return isRecord(value) && hasExactKeys(value, ['status', 'message', 'level'])
    && isGitState(value.status) && bounded(value.message, 500) && level(value.level);
}

export function isGitCloneResult(value: unknown): value is GitCloneResult {
  return isRecord(value) && hasExactKeys(value, ['selection', 'message', 'level'])
    && (value.selection === null || isProjectSelection(value.selection))
    && bounded(value.message, 500) && level(value.level);
}
