import { isDesignMutation } from './design';
import type { DesignMutation } from './design';
import { isModuleSelection } from './generator-modules';
import type { ModuleSelection } from './generator-modules';
import type { Result } from './index';
import { isGeneratorDigest, isGeneratorPath } from './generator';
import { isProjectId } from './projects';
import { isMigrationName, isSchemaName, SCHEMA_LIMITS } from './schema';
import { hasExactKeys, isRecord } from './validation';

export const INCREMENTAL_CHANNEL = {
  inspect: 'factory:incremental-inspect', preview: 'factory:incremental-preview', apply: 'factory:incremental-apply',
  resume: 'factory:incremental-resume', handoff: 'factory:incremental-handoff',
} as const;

export const INCREMENTAL_LIMITS = { writes: 56, inventory: 320, history: 12, bytes: 180_000, journal: 2_500_000 } as const;
export const ownershipStates = ['generated', 'modified', 'missing', 'user', 'discovered', 'protected'] as const;
export interface IncrementalOwnedFile { path: string; state: typeof ownershipStates[number]; owner: string | null }
export interface IncrementalTable { name: string; api: boolean; page: boolean; reason: string | null }
export interface IncrementalHistory { id: string; digest: string; files: number; at: string; outcome: 'applied' | 'handed-off' }
export interface IncrementalInspection {
  revision: string; branch: string | null; head: string | null;
  profile: { stack: string; architecture: string; engineering: string; modules: string[] } | null;
  tables: IncrementalTable[]; files: IncrementalOwnedFile[];
  sources: { name: string; sha256: string; external: boolean }[];
  issues: string[];
  history: IncrementalHistory[];
  recovery: IncrementalPreview | null;
}
export interface IncrementalSelection {
  projectId: string; revision: string; backend: string[]; frontend: string[]; modules?: ModuleSelection[]; design?: DesignMutation;
}
export interface IncrementalApproval { projectId: string; id: string }
export interface IncrementalChange {
  path: string; action: 'create' | 'modify' | 'unchanged' | 'protected' | 'conflict';
  reason: string; before: string | null; after: string | null;
}
export interface IncrementalPreview {
  id: string; digest: string; changes: IncrementalChange[]; issues: string[];
  backend: string[]; frontend: string[]; modules?: ModuleSelection[];
}

export interface IncrementalBridge {
  inspect(id: string): Promise<Result<IncrementalInspection>>;
  preview(input: IncrementalSelection): Promise<Result<IncrementalPreview>>;
  apply(input: IncrementalApproval): Promise<Result<IncrementalInspection | null>>;
  resume(input: IncrementalApproval): Promise<Result<IncrementalInspection | null>>;
  handoff(input: IncrementalApproval): Promise<Result<IncrementalInspection | null>>;
}

function string(x: unknown, max: number): x is string { return typeof x === 'string' && x.length <= max && !x.includes('\0'); }
function list<T>(x: unknown, max: number, check: (v: unknown) => v is T): x is T[] {
  return Array.isArray(x) && x.length <= max && x.every(check);
}
const issue = (x: unknown): x is string => string(x, 300);
const nullableString = (x: unknown, max: number) => x === null || string(x, max);
const names = (x: unknown): x is string[] => list(x, SCHEMA_LIMITS.tables, isSchemaName) && new Set(x).size === x.length;
const choices = (x: Record<string, unknown>): x is Record<string, unknown> & { backend: string[]; frontend: string[]; modules?: ModuleSelection[] } => names(x.backend) && names(x.frontend)
  && (!Object.hasOwn(x, 'modules') || list(x.modules, 12, isModuleSelection));

export function isIncrementalSelection(x: unknown): x is IncrementalSelection {
  return isRecord(x) && hasExactKeys(x, ['projectId', 'revision', 'backend', 'frontend', ...(Object.hasOwn(x, 'modules') ? ['modules'] : []), ...(Object.hasOwn(x, 'design') ? ['design'] : [])])
    && isProjectId(x.projectId) && isGeneratorDigest(x.revision) && choices(x)
    && (!Object.hasOwn(x, 'design') || (isDesignMutation(x.design) && !x.backend.length && !x.frontend.length && !x.modules?.length));
}

export function isIncrementalApproval(x: unknown): x is IncrementalApproval {
  return isRecord(x) && hasExactKeys(x, ['projectId', 'id']) && isProjectId(x.projectId) && isProjectId(x.id);
}

const actions = ['create', 'modify', 'unchanged', 'protected', 'conflict'];
function change(x: unknown): x is IncrementalChange {
  return isRecord(x) && hasExactKeys(x, ['path', 'action', 'reason', 'before', 'after']) && isGeneratorPath(x.path)
    && typeof x.action === 'string' && actions.includes(x.action) && issue(x.reason)
    && nullableString(x.before, INCREMENTAL_LIMITS.bytes) && nullableString(x.after, INCREMENTAL_LIMITS.bytes);
}

export function isIncrementalPreview(x: unknown): x is IncrementalPreview {
  return isRecord(x) && hasExactKeys(x, ['id', 'digest', 'changes', 'issues', 'backend', 'frontend', ...(Object.hasOwn(x, 'modules') ? ['modules'] : [])])
    && isProjectId(x.id) && isGeneratorDigest(x.digest) && list(x.changes, INCREMENTAL_LIMITS.writes, change)
    && list(x.issues, 64, issue) && choices(x);
}

function owned(x: unknown): x is IncrementalOwnedFile {
  return isRecord(x) && hasExactKeys(x, ['path', 'state', 'owner']) && string(x.path, 4096) && nullableString(x.owner, 100)
    && typeof x.state === 'string' && (ownershipStates as readonly string[]).includes(x.state);
}
function table(x: unknown): x is IncrementalTable {
  return isRecord(x) && hasExactKeys(x, ['name', 'api', 'page', 'reason']) && isSchemaName(x.name)
    && typeof x.api === 'boolean' && typeof x.page === 'boolean' && nullableString(x.reason, 300);
}
function source(x: unknown): x is IncrementalInspection['sources'][number] {
  return isRecord(x) && hasExactKeys(x, ['name', 'sha256', 'external']) && isMigrationName(x.name)
    && isGeneratorDigest(x.sha256) && typeof x.external === 'boolean';
}
export function isIncrementalHistory(x: unknown): x is IncrementalHistory {
  return isRecord(x) && hasExactKeys(x, ['id', 'digest', 'files', 'at', 'outcome']) && isProjectId(x.id)
    && isGeneratorDigest(x.digest) && typeof x.files === 'number' && Number.isInteger(x.files)
    && x.files >= 0 && x.files <= INCREMENTAL_LIMITS.writes && string(x.at, 30) && (x.outcome === 'applied' || x.outcome === 'handed-off');
}
function profile(x: unknown) {
  return x === null || (isRecord(x) && hasExactKeys(x, ['stack', 'architecture', 'engineering', 'modules'])
    && string(x.stack, 100) && string(x.architecture, 100) && string(x.engineering, 100) && list(x.modules, 16, issue));
}
export function isIncrementalInspection(x: unknown): x is IncrementalInspection {
  return isRecord(x) && hasExactKeys(x, ['revision', 'branch', 'head', 'profile', 'tables', 'files', 'sources', 'issues', 'history', 'recovery'])
    && isGeneratorDigest(x.revision) && nullableString(x.branch, 1024) && nullableString(x.head, 64) && profile(x.profile)
    && list(x.tables, SCHEMA_LIMITS.tables, table) && list(x.files, INCREMENTAL_LIMITS.inventory, owned)
    && list(x.sources, SCHEMA_LIMITS.migrations, source) && list(x.issues, 64, issue) && list(x.history, INCREMENTAL_LIMITS.history, isIncrementalHistory)
    && (x.recovery === null || isIncrementalPreview(x.recovery));
}
export const isNullableIncrementalInspection = (x: unknown): x is IncrementalInspection | null => x === null || isIncrementalInspection(x);
