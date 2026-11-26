import { GIT_LIMIT, isGitDiff, isGitOid, isGitOutcome, isGitRef } from './git';
import type { GitDiff, GitOutcome } from './git';
import { isProjectId, isProjectSegment, isProjectSelection, PROJECT_LIMITS } from './projects';
import type { ProjectSelection } from './projects';
import { hasControlCharacters, hasExactKeys, isRecord } from './validation';
import type { Result } from './index';

export const GIT_ADVANCED_CHANNEL = {
  details: 'factory:git-workspace-details',
  review: 'factory:git-review-operation',
  apply: 'factory:git-apply-operation',
} as const;

export interface GitScope { id: string; revision: string }
export type GitReviewInput = GitScope & (
  | { kind: 'switch'; ref: string }
  | { kind: 'branch-delete'; ref: string }
  | { kind: 'branch-rename'; ref: string; name: string }
  | { kind: 'file-replace'; ref: string; path: string }
  | { kind: 'worktree-add'; ref: string; folder: string; branch: string | null }
  | { kind: 'worktree-open' | 'worktree-remove' | 'worktree-inspect'; row: number; path: string }
  | { kind: 'stash-create'; message: string; untracked: boolean }
  | { kind: 'stash-inspect' | 'stash-apply' | 'stash-pop' | 'stash-drop'; row: number; oid: string }
  | { kind: 'merge'; source: string; strategy: 'ff-only' | 'merge' }
  | { kind: 'rebase' | 'cherry-pick'; source: string }
  | { kind: 'conflict-inspect' | 'conflict-stage' | 'conflict-reveal'; row: number }
  | { kind: 'continue' | 'abort' }
);
export interface GitApproved { id: string; ticket: string }

export interface GitWorktree {
  path: string;
  head: string | null;
  branch: string | null;
  active: boolean;
  primary: boolean;
  locked: boolean;
  missing: boolean;
}
export interface GitStash { oid: string; label: string }
export interface GitWorkspaceDetails {
  worktrees: GitWorktree[];
  stashes: GitStash[];
  conflicts: string[];
  recovery: boolean;
}
export interface GitVersionText { label: string; value: GitDiff }
export interface GitReview {
  ticket: string | null;
  title: string;
  detail: string;
  blocked: string | null;
  files: string[];
  patch: GitDiff | null;
  versions: GitVersionText[];
}
export interface GitAdvancedOutcome extends GitOutcome { selection: ProjectSelection | null }

export interface GitAdvancedBridge {
  details(scope: GitScope): Promise<Result<GitWorkspaceDetails>>;
  review(request: GitReviewInput): Promise<Result<GitReview | null>>;
  apply(request: GitApproved): Promise<Result<GitAdvancedOutcome>>;
}

const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
const optional = (value: unknown, max: number) => value === null || text(value, max);
const row = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < GIT_LIMIT.changes;
const revision = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
const localRef = (value: unknown) => isGitRef(value) && value.startsWith('refs/heads/');
const simple = (value: unknown, max: number): value is string => text(value, max) && !hasControlCharacters(value) && !/[\p{Cf}\uFFFD]/u.test(value);

export function isGitScope(value: unknown): value is GitScope {
  return isRecord(value) && hasExactKeys(value, ['id', 'revision']) && isProjectId(value.id) && revision(value.revision);
}
export function isGitReviewInput(value: unknown): value is GitReviewInput {
  if (!isRecord(value) || !isProjectId(value.id) || !revision(value.revision)) return false;
  const fields = (...keys: string[]) => hasExactKeys(value, ['id', 'revision', 'kind', ...keys]);
  switch (value.kind) {
    case 'switch':
    case 'branch-delete': return fields('ref') && localRef(value.ref);
    case 'branch-rename': return fields('ref', 'name') && localRef(value.ref) && simple(value.name, 240)
      && !value.name.startsWith('-') && localRef('refs/heads/' + value.name);
    case 'file-replace': return fields('ref', 'path') && isGitRef(value.ref) && simple(value.path, PROJECT_LIMITS.relativePath)
      && value.path.split('/').every(isProjectSegment);
    case 'worktree-add': return fields('ref', 'folder', 'branch') && localRef(value.ref)
      && simple(value.folder, 120) && isProjectSegment(value.folder) && /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u.test(value.folder)
      && (value.branch === null || (simple(value.branch, 240) && !value.branch.startsWith('-') && localRef('refs/heads/' + value.branch)));
    case 'worktree-open':
    case 'worktree-inspect':
    case 'worktree-remove': return fields('row', 'path') && row(value.row) && simple(value.path, PROJECT_LIMITS.absolutePath);
    case 'conflict-reveal':
    case 'conflict-inspect':
    case 'conflict-stage': return fields('row') && row(value.row);
    case 'stash-create': return fields('message', 'untracked') && simple(value.message, 240) && Boolean(value.message.trim()) && typeof value.untracked === 'boolean';
    case 'stash-inspect':
    case 'stash-apply':
    case 'stash-pop':
    case 'stash-drop': return fields('row', 'oid') && row(value.row) && isGitOid(value.oid);
    case 'merge': return fields('source', 'strategy') && (isGitOid(value.source) || isGitRef(value.source))
      && (value.strategy === 'ff-only' || value.strategy === 'merge');
    case 'rebase': return fields('source') && (isGitOid(value.source) || isGitRef(value.source));
    case 'cherry-pick': return fields('source') && isGitOid(value.source);
    case 'continue':
    case 'abort': return fields();
    default: return false;
  }
}

export function isGitApproved(value: unknown): value is GitApproved {
  return isRecord(value) && hasExactKeys(value, ['id', 'ticket']) && isProjectId(value.id) && isProjectId(value.ticket);
}
const names = (value: unknown) => Array.isArray(value) && value.length <= GIT_LIMIT.changes && value.every((item) => text(item, 4096));
export function isGitWorkspaceDetails(value: unknown): value is GitWorkspaceDetails {
  return isRecord(value) && hasExactKeys(value, ['worktrees', 'stashes', 'conflicts', 'recovery'])
    && typeof value.recovery === 'boolean' && names(value.conflicts)
    && Array.isArray(value.worktrees) && value.worktrees.length <= 64 && value.worktrees.every((item: unknown) =>
      isRecord(item) && hasExactKeys(item, ['path', 'head', 'branch', 'active', 'primary', 'locked', 'missing'])
      && simple(item.path, PROJECT_LIMITS.absolutePath) && (item.head === null || isGitOid(item.head))
      && (item.branch === null || localRef(item.branch)) && ['active', 'primary', 'locked', 'missing'].every((key) => typeof item[key] === 'boolean'))
    && Array.isArray(value.stashes) && value.stashes.length <= 128 && value.stashes.every((item: unknown) =>
      isRecord(item) && hasExactKeys(item, ['oid', 'label']) && isGitOid(item.oid) && text(item.label, 500));
}
export function isGitReview(value: unknown): value is GitReview | null {
  return value === null || (isRecord(value) && hasExactKeys(value, ['ticket', 'title', 'detail', 'blocked', 'files', 'patch', 'versions'])
    && (value.ticket === null || isProjectId(value.ticket)) && text(value.title, 160) && text(value.detail, 64_000)
    && optional(value.blocked, 1000) && names(value.files) && (value.patch === null || isGitDiff(value.patch))
    && Array.isArray(value.versions) && value.versions.length <= 3 && value.versions.every((item: unknown) =>
      isRecord(item) && hasExactKeys(item, ['value', 'label']) && text(item.label, 90) && isGitDiff(item.value)));
}
export function isGitAdvancedOutcome(value: unknown): value is GitAdvancedOutcome {
  if (!isRecord(value)) return false;
  const { selection, ...outcome } = value;
  return (selection === null || isProjectSelection(selection)) && isGitOutcome(outcome);
}
