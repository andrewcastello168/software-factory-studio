import type { Result } from './index';
import { hasControlCharacters, hasExactKeys, isRecord } from './validation';

export const PROJECT_CHANNEL = {
  list: 'factory:projects-list',
  openFolder: 'factory:projects-open-folder',
  openRecent: 'factory:projects-open-recent',
  locateRecent: 'factory:projects-locate-recent',
  removeRecent: 'factory:projects-remove-recent',
  rescan: 'factory:projects-rescan',
  close: 'factory:projects-close',
  changed: 'factory:projects-changed',
} as const;

export const PROJECT_LIMITS = {
  tabs: 8,
  recents: 24,
  entries: 1600,
  depth: 10,
  relativePath: 4096,
  absolutePath: 32767,
} as const;

export type ProjectAvailability = 'ready' | 'missing' | 'changed' | 'unavailable';
export type ProjectEntryKind = 'directory' | 'file' | 'link';

export interface ProjectDescriptor {
  id: string;
  name: string | null;
  type: string | null;
  stackId: string | null;
  profileId: string | null;
}

export type ProjectMetadata =
  | { status: 'absent' | 'invalid' | 'unsupported' | 'blocked' }
  | { status: 'managed'; descriptor: ProjectDescriptor };

export interface ProjectEntry {
  path: string;
  kind: ProjectEntryKind;
  modifiedAt: number | null;
  size: number | null;
}

export interface OpenProject {
  id: string;
  recentId: string;
  name: string;
  directory: string;
  availability: ProjectAvailability;
  metadata: ProjectMetadata;
  entries: ProjectEntry[];
  partial: boolean;
  refreshing: boolean;
}

export interface RecentProject {
  id: string;
  name: string;
  directory: string;
  availability: ProjectAvailability;
}

export interface ProjectCatalog {
  revision: number;
  projects: OpenProject[];
  recents: RecentProject[];
  recentsStatus: 'ready' | 'unreadable' | 'unsaved';
}

export interface ProjectSelection {
  projectId: string | null;
  catalog: ProjectCatalog;
}

export interface ProjectBridge {
  list(): Promise<Result<ProjectCatalog>>;
  openFolder(): Promise<Result<ProjectSelection>>;
  openRecent(id: string): Promise<Result<ProjectSelection>>;
  locateRecent(id: string): Promise<Result<ProjectSelection>>;
  removeRecent(id: string): Promise<Result<ProjectCatalog>>;
  rescan(id: string): Promise<Result<ProjectCatalog>>;
  close(id: string): Promise<Result<ProjectCatalog>>;
  onChange(listener: (catalog: ProjectCatalog) => void): () => void;
}

export function isProjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

export function isProjectSegment(value: string): boolean {
  return value.length > 0 && value.length <= 255 && !/[\\/:*?"<>|]/u.test(value) && !hasControlCharacters(value)
    && !/[ .]$/u.test(value)
    && !/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:[ .]|$)/iu.test(value);
}

function isRelativeProjectPath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= PROJECT_LIMITS.relativePath
    && value.split('/').length <= PROJECT_LIMITS.depth + 1
    && value.split('/').every(isProjectSegment);
}

function stringInRange(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit && !value.includes('\0');
}

function isAvailability(value: unknown): value is ProjectAvailability {
  return value === 'ready' || value === 'missing' || value === 'changed' || value === 'unavailable';
}

function isDescriptor(value: unknown): value is ProjectDescriptor {
  return isRecord(value) && hasExactKeys(value, ['id', 'name', 'type', 'stackId', 'profileId'])
    && isProjectId(value.id)
    && [value.name, value.type, value.stackId, value.profileId].every((item) => item === null || stringInRange(item, 120));
}

function isMetadata(value: unknown): value is ProjectMetadata {
  if (!isRecord(value)) return false;
  return value.status === 'managed' ? hasExactKeys(value, ['status', 'descriptor']) && isDescriptor(value.descriptor)
    : hasExactKeys(value, ['status']) && (
      value.status === 'absent' || value.status === 'invalid' || value.status === 'unsupported' || value.status === 'blocked'
    );
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isEntry(value: unknown): value is ProjectEntry {
  return isRecord(value) && hasExactKeys(value, ['path', 'kind', 'modifiedAt', 'size'])
    && isRelativeProjectPath(value.path)
    && (value.kind === 'directory' || value.kind === 'file' || value.kind === 'link')
    && (value.modifiedAt === null || (typeof value.modifiedAt === 'number' && Number.isFinite(value.modifiedAt)))
    && (value.size === null || isCount(value.size));
}

function isProjectLabel(value: Record<string, unknown>): boolean {
  return isProjectId(value.id) && isAvailability(value.availability)
    && stringInRange(value.name, 255) && stringInRange(value.directory, PROJECT_LIMITS.absolutePath);
}

export function isOpenProject(value: unknown): value is OpenProject {
  return isRecord(value) && hasExactKeys(value, [
    'id', 'recentId', 'name', 'directory', 'availability', 'metadata', 'entries', 'partial', 'refreshing',
  ]) && isProjectLabel(value) && isProjectId(value.recentId)
    && isMetadata(value.metadata) && Array.isArray(value.entries) && value.entries.length <= PROJECT_LIMITS.entries
    && value.entries.every(isEntry) && typeof value.partial === 'boolean' && typeof value.refreshing === 'boolean';
}

function isRecent(value: unknown): value is RecentProject {
  return isRecord(value) && hasExactKeys(value, ['id', 'name', 'directory', 'availability']) && isProjectLabel(value);
}

export function isProjectCatalog(value: unknown): value is ProjectCatalog {
  return isRecord(value) && hasExactKeys(value, ['revision', 'projects', 'recents', 'recentsStatus'])
    && isCount(value.revision) && Array.isArray(value.projects) && value.projects.length <= PROJECT_LIMITS.tabs
    && value.projects.every(isOpenProject) && Array.isArray(value.recents) && value.recents.length <= PROJECT_LIMITS.recents
    && value.recents.every(isRecent)
    && (value.recentsStatus === 'ready' || value.recentsStatus === 'unreadable' || value.recentsStatus === 'unsaved');
}

export function isProjectSelection(value: unknown): value is ProjectSelection {
  return isRecord(value) && hasExactKeys(value, ['projectId', 'catalog'])
    && (value.projectId === null || isProjectId(value.projectId)) && isProjectCatalog(value.catalog);
}
