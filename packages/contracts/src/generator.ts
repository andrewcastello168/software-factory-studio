import type { ProjectSelection, Result } from './index';
import { isProjectId, isProjectSegment, isProjectSelection, PROJECT_LIMITS } from './projects';
import { hasControlCharacters, hasExactKeys, isRecord } from './validation';

export const GENERATOR_CHANNEL = {
  choose: 'factory:generator-choose-parent',
  preview: 'factory:generator-preview',
  apply: 'factory:generator-apply',
  pending: 'factory:generator-pending',
  resume: 'factory:generator-resume',
  release: 'factory:generator-release-record',
} as const;

export const STARTER = {
  appType: 'full-stack',
  stack: 'node-express-react-postgres',
  architecture: 'layered-web',
  engineering: 'standard-engineering',
  engineVersion: '1.0.0',
  templateVersion: '1.0.0',
  architectureVersion: '1.0.0',
  engineeringVersion: '1.0.0',
  stackLabel: 'Node.js · TypeScript · Express · React · Vite · PostgreSQL',
} as const;

export const GENERATOR_LIMITS = { files: 64, fileBytes: 180_000, pending: 32 } as const;

export interface StarterConfig {
  name: string;
  slug: string;
  port: number;
  appType: typeof STARTER.appType;
  stack: typeof STARTER.stack;
  architecture: typeof STARTER.architecture;
  engineering: typeof STARTER.engineering;
}

export interface GeneratorParent {
  id: string;
  directory: string;
}

export interface GeneratorRequest {
  parentId: string;
  config: StarterConfig;
}

export interface GeneratorFile {
  path: string;
  content: string;
  sha256: string;
}

export interface GeneratorPreview {
  id: string;
  digest: string;
  directory: string;
  config: StarterConfig;
  files: GeneratorFile[];
}

export interface GeneratorReceipt {
  directory: string;
  fileCount: number;
  selection: ProjectSelection | null;
}

export interface GeneratorPending {
  id: string;
  name: string;
  directory: string;
  createdFiles: number;
}

export interface GeneratorBridge {
  chooseParent(): Promise<Result<GeneratorParent | null>>;
  preview(input: GeneratorRequest): Promise<Result<GeneratorPreview>>;
  apply(id: string): Promise<Result<GeneratorReceipt | null>>;
  pending(): Promise<Result<GeneratorPending[]>>;
  resume(id: string): Promise<Result<GeneratorReceipt | null>>;
  release(id: string): Promise<Result<GeneratorPending[]>>;
}

export function isStarterName(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && value.normalize('NFC') === value
    && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,69}$/u.test(value);
}

export function isStarterSlug(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 48 && isProjectSegment(value)
    && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(value);
}

export function isStarterPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1024 && value <= 65535;
}

export function isStarterConfig(value: unknown): value is StarterConfig {
  return isRecord(value) && hasExactKeys(value, ['name', 'slug', 'port', 'appType', 'stack', 'architecture', 'engineering'])
    && isStarterName(value.name) && isStarterSlug(value.slug) && isStarterPort(value.port)
    && value.appType === STARTER.appType && value.stack === STARTER.stack
    && value.architecture === STARTER.architecture && value.engineering === STARTER.engineering;
}

export function isGeneratorRequest(value: unknown): value is GeneratorRequest {
  return isRecord(value) && hasExactKeys(value, ['parentId', 'config'])
    && isProjectId(value.parentId) && isStarterConfig(value.config);
}

function isDirectory(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= PROJECT_LIMITS.absolutePath
    && !hasControlCharacters(value);
}

export function isGeneratorParent(value: unknown): value is GeneratorParent | null {
  return value === null || (isRecord(value) && hasExactKeys(value, ['id', 'directory'])
    && isProjectId(value.id) && isDirectory(value.directory));
}

export function isGeneratorDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value);
}

export function isGeneratorPath(value: unknown): value is string {
  // Built-in paths use portable ASCII segments and '/' separators.
  return typeof value === 'string' && value.length <= 180 && value.split('/').length <= 6
    && value.split('/').every((part) => /^[a-zA-Z0-9._-]+$/u.test(part) && isProjectSegment(part)
      && !/^\.git$|^git~\d+$/iu.test(part));
}

function isFile(value: unknown): value is GeneratorFile {
  return isRecord(value) && hasExactKeys(value, ['path', 'content', 'sha256']) && isGeneratorPath(value.path)
    && typeof value.content === 'string' && value.content.length <= GENERATOR_LIMITS.fileBytes
    && !value.content.includes('\0') && isGeneratorDigest(value.sha256);
}

export function isGeneratorPreview(value: unknown): value is GeneratorPreview {
  return isRecord(value) && hasExactKeys(value, ['id', 'digest', 'directory', 'config', 'files'])
    && isProjectId(value.id) && isGeneratorDigest(value.digest) && isDirectory(value.directory)
    && isStarterConfig(value.config) && Array.isArray(value.files) && value.files.length > 0
    && value.files.length <= GENERATOR_LIMITS.files && value.files.every(isFile);
}

function fileCount(value: unknown): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= GENERATOR_LIMITS.files;
}

export function isGeneratorReceipt(value: unknown): value is GeneratorReceipt | null {
  return value === null || (isRecord(value) && hasExactKeys(value, ['directory', 'fileCount', 'selection'])
    && isDirectory(value.directory) && fileCount(value.fileCount) && value.fileCount !== 0
    && (value.selection === null || isProjectSelection(value.selection)));
}

export function isGeneratorPending(value: unknown): value is GeneratorPending[] {
  return Array.isArray(value) && value.length <= GENERATOR_LIMITS.pending && value.every((item: unknown) =>
    isRecord(item) && hasExactKeys(item, ['id', 'name', 'directory', 'createdFiles']) && isProjectId(item.id)
    && isStarterName(item.name) && isDirectory(item.directory) && fileCount(item.createdFiles));
}
