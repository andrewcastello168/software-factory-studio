import type { DesignBridge } from './design';
export * from './design';
import type { DeveloperBridge } from './developer';
export * from './developer';
export * from './stacks';
import type { LibraryBridge } from './library';
import { hasExactKeys, isRecord } from './validation';
import type { ProjectBridge } from './projects';
import type { GitBridge } from './git';
import type { IncrementalBridge } from './incremental';
import type { SchemaBridge } from './schema';
import type { GeneratorBridge } from './generator';

export { hasControlCharacters, hasExactKeys, isRecord } from './validation';
export * from './projects';
export * from './git';
export * from './git-advanced';
export * from './generator';
export * from './generator-modules';
export * from './schema';
export * from './incremental';
export * from './library';

export const CHANNEL = {
  appInfo: 'factory:app-info',
  readPreferences: 'factory:read-preferences',
  writePreferences: 'factory:write-preferences',
  systemTheme: 'factory:system-theme',
} as const;

export const SIDEBAR = { minimum: 180, maximum: 320, initial: 240, step: 8 } as const;

export type SystemTheme = 'light' | 'dark';
export type Theme = 'system' | SystemTheme;
export type DesktopPlatform = 'win32' | 'linux' | 'darwin';

export interface AppInfo {
  version: string;
  platform: DesktopPlatform;
}

export interface Preferences {
  theme: Theme;
  sidebarWidth: number;
}

export interface PreferenceSnapshot {
  preferences: Preferences;
  systemTheme: SystemTheme;
  storage: 'ready' | 'corrupt' | 'unsupported';
}

export type PreferenceWrite =
  | { action: 'update'; changes: Partial<Preferences> }
  | { action: 'restoreDefaults' };

const errorCodes = [
  'INVALID_REQUEST',
  'ACCESS_DENIED',
  'INVALID_REPLY',
  'BRIDGE_UNAVAILABLE',
  'PREFERENCES_READ_FAILED',
  'PREFERENCES_WRITE_FAILED',
  'PREFERENCES_REVIEW_REQUIRED',
  'PROJECT_UNAVAILABLE',
  'PROJECT_LIMIT',
  'PROJECT_BUSY',
  'RECENT_NOT_FOUND',
  'GIT_STALE',
  'GIT_DIFF_UNAVAILABLE',
  'GENERATOR_DESTINATION',
  'GENERATOR_STALE',
  'GENERATOR_STORAGE',
  'GENERATOR_RECOVERY',
  'GENERATOR_CONFLICT',
  'SCHEMA_UNAVAILABLE',
  'SCHEMA_STALE',
  'SCHEMA_CONFLICT',
  'SCHEMA_DATABASE',
  'SCHEMA_STORAGE',
  'INCREMENTAL_STALE',
  'INCREMENTAL_UNSUPPORTED',
  'INCREMENTAL_CONFLICT',
  'LIBRARY_CONFLICT',
  'DEVELOPER_UNSUPPORTED',
  'DEVELOPER_STALE',
  'DEVELOPER_TOOL',
  'DEVELOPER_ENVIRONMENT',
  'DEVELOPER_PORT',
  'DEVELOPER_PROCESS',
  'DEVELOPER_NETWORK',
  'DESIGN_CONFLICT',
] as const;

export type ErrorCode = typeof errorCodes[number];
export type Result<T> = { ok: true; value: T } | { ok: false; error: ErrorCode };
export type Validator<T> = (value: unknown) => value is T;

export interface StudioBridge {
  developer: DeveloperBridge;
  design: DesignBridge;
  projects: ProjectBridge;
  git: GitBridge;
  generator: GeneratorBridge;
  schema: SchemaBridge;
  incremental: IncrementalBridge;
  library: LibraryBridge;
  getAppInfo(): Promise<Result<AppInfo>>;
  readPreferences(): Promise<Result<PreferenceSnapshot>>;
  writePreferences(request: PreferenceWrite): Promise<Result<Preferences>>;
  onSystemThemeChange(listener: (theme: SystemTheme) => void): () => void;
}

export const defaultPreferences: Readonly<Preferences> = Object.freeze({
  theme: 'system',
  sidebarWidth: SIDEBAR.initial,
});

export function success<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function failure(error: ErrorCode): Result<never> {
  return { ok: false, error };
}

export function isSystemTheme(value: unknown): value is SystemTheme {
  return value === 'light' || value === 'dark';
}

export function isTheme(value: unknown): value is Theme {
  return value === 'system' || isSystemTheme(value);
}

export function isSidebarWidth(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value)
    && value >= SIDEBAR.minimum && value <= SIDEBAR.maximum;
}

export function isAppInfo(value: unknown): value is AppInfo {
  return isRecord(value) && hasExactKeys(value, ['version', 'platform'])
    && typeof value.version === 'string' && /^[\w.+-]{1,40}$/.test(value.version)
    && (value.platform === 'win32' || value.platform === 'linux' || value.platform === 'darwin');
}

export function isPreferences(value: unknown): value is Preferences {
  return isRecord(value) && hasExactKeys(value, ['theme', 'sidebarWidth'])
    && isTheme(value.theme) && isSidebarWidth(value.sidebarWidth);
}

export function isPreferenceSnapshot(value: unknown): value is PreferenceSnapshot {
  return isRecord(value) && hasExactKeys(value, ['preferences', 'systemTheme', 'storage'])
    && isPreferences(value.preferences) && isSystemTheme(value.systemTheme)
    && (value.storage === 'ready' || value.storage === 'corrupt' || value.storage === 'unsupported');
}

export function isPreferenceWrite(value: unknown): value is PreferenceWrite {
  if (!isRecord(value) || !Object.hasOwn(value, 'action')) return false;
  if (value.action === 'restoreDefaults') return hasExactKeys(value, ['action']);
  if (value.action !== 'update' || !hasExactKeys(value, ['action', 'changes']) || !isRecord(value.changes)) {
    return false;
  }

  const changes = value.changes;
  const keys = Object.keys(changes);
  return keys.length > 0 && keys.every((key) => {
    if (key === 'theme') return isTheme(changes.theme);
    return key === 'sidebarWidth' && isSidebarWidth(changes.sidebarWidth);
  });
}

export function validateReply<T>(value: unknown, validate: Validator<T>): Result<T> {
  if (!isRecord(value) || !Object.hasOwn(value, 'ok')) return failure('INVALID_REPLY');
  if (value.ok === true && hasExactKeys(value, ['ok', 'value']) && validate(value.value)) {
    return success(value.value);
  }
  if (value.ok === false && hasExactKeys(value, ['ok', 'error'])) {
    const error = errorCodes.find((code) => code === value.error);
    if (error) return failure(error);
  }
  return failure('INVALID_REPLY');
}
