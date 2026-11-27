import type { Result } from './index';
import { NODE_STACK, GO_STACK } from './stacks';
import type { StackId } from './stacks';
import { isProjectId } from './projects';
import { isGeneratorDigest } from './generator';
import { hasExactKeys, isRecord } from './validation';

export const DELIVERY_CHANNEL = {
  inspect: 'factory:delivery-inspect', package: 'factory:delivery-package',
  shares: 'factory:delivery-shares', export: 'factory:delivery-export', import: 'factory:delivery-import',
} as const;
export const qualityTasks = ['lint', 'typecheck', 'test', 'build', 'audit', 'format', 'vet', 'vulnerability', 'postgres'] as const;
export type QualityTask = typeof qualityTasks[number];
export const isQualityTask = (x: unknown): x is QualityTask => (qualityTasks as readonly unknown[]).includes(x);
export const requiredQuality = (stack: StackId): readonly QualityTask[] =>
  stack === GO_STACK ? ['lint', 'typecheck', 'format', 'vet', 'test', 'build'] : ['lint', 'typecheck', 'test', 'build'];
export type DeliveryOption = 'ci' | 'docker';
export const isDeliveryOption = (x: unknown): x is DeliveryOption => x === 'ci' || x === 'docker';
export interface QualityEvidence {
  id: string; task: QualityTask; revision: string; source: string; head: string | null; started: string; ended: string;
  outcome: 'passed' | 'failed' | 'interrupted'; code: number | null; output: string | null;
}
export interface ReleaseEvidence {
  id: string; name: string; version: string; stack: StackId; source: string; head: string; created: string;
  file: string; sha256: string; bytes: number; notes: string; lock: string; checks: string[];
}
export interface DeliveryInspection {
  stack: StackId | null; name: string; project: string | null; template: string | null; worktree: string; branch: string | null; head: string | null; clean: boolean;
  source: string | null; environment: string[]; locks: { name: string; digest: string | null }[];
  quality: QualityEvidence[]; releases: { release: ReleaseEvidence; artifact: 'available' | 'missing' | 'changed' | 'unavailable' }[];
}
export interface PackageRequest { projectId: string; version: string; notes: string; source: string }
export interface AssetPin { id: string; version: number }
export interface ShareExport { projectId: string; assets: AssetPin[] }
export interface ShareImport { projectId: string; digest: string }
export interface SharedOverview {
  digest: string; assets: { id: string; version: number; name: string; kind: 'profile' | 'template' }[];
}
export interface SharedLibrary { entries: SharedOverview[]; rejected: number }
export interface DeliveryBridge {
  inspect(projectId: string): Promise<Result<DeliveryInspection>>;
  package(input: PackageRequest): Promise<Result<ReleaseEvidence | null>>;
  shares(projectId: string): Promise<Result<SharedLibrary>>;
  export(input: ShareExport): Promise<Result<SharedOverview | null>>;
  import(input: ShareImport): Promise<Result<number | null>>;
}

const shape = (x: unknown, keys: string[]): x is Record<string, unknown> => isRecord(x) && hasExactKeys(x, keys);
const text = (x: unknown, max = 400): x is string => typeof x === 'string' && x.length <= max && !x.includes('\0');
const nullable = (x: unknown, accept: (value: unknown) => boolean) => x === null || accept(x);
const list = <T>(x: unknown, limit: number, accept: (value: unknown) => value is T): x is T[] =>
  Array.isArray(x) && x.length <= limit && x.every(accept);
const short = (x: unknown): x is string => text(x);
const stack = (x: unknown): x is StackId => x === NODE_STACK || x === GO_STACK;
const iso = (x: unknown) => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(x);
const natural = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const commit = (x: unknown) => typeof x === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u.test(x);
const version = (x: unknown) => typeof x === 'string' && /^(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})\.(?:0|[1-9]\d{0,5})(?:-[a-z0-9][a-z0-9.-]{0,19})?$/u.test(x);
const notes = (x: unknown) => text(x, 1600) && !/(?:\w+:\/\/[^\s]*@|-----BEGIN|\b(?:password|secret|token|authorization|api[_ -]?key)\s*[:=]|\b(?:ghp_|github_pat_|AKIA|sk-)[\w-]{8,})/iu.test(x);
export const isQualityEvidence = (x: unknown): x is QualityEvidence =>
  shape(x, ['id', 'task', 'revision', 'source', 'head', 'started', 'ended', 'outcome', 'code', 'output'])
  && isProjectId(x.id) && isQualityTask(x.task) && isGeneratorDigest(x.revision) && isGeneratorDigest(x.source)
  && nullable(x.head, commit) && iso(x.started) && iso(x.ended) && ['passed', 'failed', 'interrupted'].includes(String(x.outcome))
  && nullable(x.code, Number.isInteger) && nullable(x.output, isGeneratorDigest);
export const isReleaseEvidence = (x: unknown): x is ReleaseEvidence =>
  shape(x, ['id', 'name', 'version', 'stack', 'source', 'head', 'created', 'file', 'sha256', 'bytes', 'notes', 'lock', 'checks'])
  && isProjectId(x.id) && short(x.name) && version(x.version) && stack(x.stack) && isGeneratorDigest(x.source)
  && commit(x.head) && iso(x.created) && text(x.file, 4096) && isGeneratorDigest(x.sha256)
  && natural(x.bytes) && notes(x.notes) && isGeneratorDigest(x.lock) && list(x.checks, qualityTasks.length, isProjectId);
export const isNullableRelease = (x: unknown): x is ReleaseEvidence | null => x === null || isReleaseEvidence(x);
const lock = (x: unknown): x is DeliveryInspection['locks'][number] =>
  shape(x, ['name', 'digest']) && short(x.name) && nullable(x.digest, isGeneratorDigest);
const artifact = (x: unknown): x is DeliveryInspection['releases'][number] =>
  shape(x, ['release', 'artifact']) && isReleaseEvidence(x.release) && ['available', 'missing', 'changed', 'unavailable'].includes(String(x.artifact));
export const isDeliveryInspection = (x: unknown): x is DeliveryInspection =>
  shape(x, ['stack', 'name', 'project', 'template', 'worktree', 'branch', 'head', 'clean', 'source', 'environment', 'locks', 'quality', 'releases'])
  && nullable(x.stack, stack) && short(x.name) && nullable(x.project, isProjectId) && nullable(x.template, short) && text(x.worktree, 4096) && nullable(x.branch, short) && nullable(x.head, commit)
  && typeof x.clean === 'boolean' && nullable(x.source, isGeneratorDigest) && list(x.environment, 64, short) && list(x.locks, 12, lock)
  && list(x.quality, 80, isQualityEvidence) && list(x.releases, 40, artifact);
export const isPackageRequest = (x: unknown): x is PackageRequest =>
  shape(x, ['projectId', 'version', 'notes', 'source']) && isProjectId(x.projectId) && version(x.version) && notes(x.notes) && isGeneratorDigest(x.source);
const pin = (x: unknown): x is AssetPin =>
  isRecord(x) && isProjectId(x.id) && natural(x.version) && x.version > 0 && x.version <= 9999;
const strictPin = (x: unknown): x is AssetPin => shape(x, ['id', 'version']) && pin(x);
export const isShareExport = (x: unknown): x is ShareExport =>
  shape(x, ['projectId', 'assets']) && isProjectId(x.projectId) && list(x.assets, 8, strictPin) && x.assets.length > 0
  && new Set(x.assets.map(({ id, version: v }) => id + ':' + v)).size === x.assets.length;
export const isShareImport = (x: unknown): x is ShareImport =>
  shape(x, ['projectId', 'digest']) && isProjectId(x.projectId) && isGeneratorDigest(x.digest);
const overviewAsset = (x: unknown): x is SharedOverview['assets'][number] =>
  shape(x, ['id', 'version', 'name', 'kind']) && pin(x) && short(x.name) && (x.kind === 'profile' || x.kind === 'template');
export const isSharedOverview = (x: unknown): x is SharedOverview =>
  shape(x, ['digest', 'assets']) && isGeneratorDigest(x.digest) && list(x.assets, 8, overviewAsset);
export const isSharedLibrary = (x: unknown): x is SharedLibrary =>
  shape(x, ['entries', 'rejected']) && list(x.entries, 80, isSharedOverview) && natural(x.rejected);
export const isShareExportResult = (x: unknown): x is SharedOverview | null => x === null || isSharedOverview(x);
export const isShareImportResult = (x: unknown): x is number | null => x === null || natural(x);
