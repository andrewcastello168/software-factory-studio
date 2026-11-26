import type { Result } from './index';
import { hasExactKeys, isRecord } from './validation';
import { isProjectId } from './projects';

export const LIBRARY_CHANNEL = { list: 'factory:library-list', publish: 'factory:library-publish' } as const;
export const LIBRARY_LIMIT = 64;
export const PROFILE_TOPICS = [
  'Structure', 'Architecture', 'Naming', 'Layer responsibilities', 'API responses', 'Error handling',
  'Validation', 'Database access', 'Migrations', 'Environment', 'Logging', 'Security', 'Testing', 'Documentation', 'AI coding',
] as const;
export type ProfileTopic = typeof PROFILE_TOPICS[number];
export interface EngineeringProfile { kind: 'profile'; id: string; version: number; name: string; advice: Partial<Record<ProfileTopic, string>> }
export interface InterfaceTemplate { kind: 'template'; id: string; version: number; name: string; color: string; theme: 'system' | 'light' | 'dark'; mark: string }
export type LibraryAsset = EngineeringProfile | InterfaceTemplate;
export interface LibrarySelection { profile: EngineeringProfile; template?: InterfaceTemplate; branding?: { color: string; theme: InterfaceTemplate['theme']; mark: string } }
export const STANDARD_PROFILE: EngineeringProfile = { kind: 'profile', id: 'standard-engineering', version: 1, name: 'Standard Engineering', advice: {} };
export const BUSINESS_TEMPLATE: InterfaceTemplate = { kind: 'template', id: 'business-workspace', version: 1, name: 'Business Workspace', color: '#2458a4', theme: 'system', mark: '' };
export const BUILTIN_LIBRARY: readonly LibraryAsset[] = [STANDARD_PROFILE, BUSINESS_TEMPLATE];
export interface LibraryBridge {
  list(): Promise<Result<LibraryAsset[]>>;
  publish(asset: LibraryAsset): Promise<Result<LibraryAsset>>;
}

function assetName(x: unknown): x is string {
  return typeof x === 'string' && /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,59}$/u.test(x) && x === x.trim() && adviceText(x);
}

function adviceText(value: unknown) {
  return typeof value === 'string' && value.length <= 320 && !/[\p{Cc}\p{Cf}<>]/u.test(value)
    && !/(?:\w+:\/\/|\b(?:password|secret|token|api[ _-]?key|authorization)\s*[:=]|-----BEGIN|\b(?:ghp_|github_pat_|AKIA|sk-)[\w-]{8,})/iu.test(value);
}

function branding(x: Record<string, unknown>) {
  return typeof x.color === 'string' && /^#[a-f0-9]{6}$/iu.test(x.color)
    && (x.theme === 'system' || x.theme === 'light' || x.theme === 'dark')
    && typeof x.mark === 'string' && /^[\p{L}\p{N}]{0,4}$/u.test(x.mark);
}

export function isLibraryAsset(x: unknown): x is LibraryAsset {
  if (!isRecord(x) || !assetName(x.name) || typeof x.version !== 'number' || !Number.isInteger(x.version)
    || x.version < 1 || x.version > 9999) return false;
  const builtin = BUILTIN_LIBRARY.find(({ id }) => id === x.id);
  if (builtin && (builtin.kind !== x.kind || builtin.name !== x.name || x.version !== 1)) return false;
  if (!builtin && !isProjectId(x.id)) return false;
  const keys = ['id', 'version', 'name', 'kind'];
  if (x.kind === 'template') return hasExactKeys(x, [...keys, 'color', 'theme', 'mark']) && branding(x)
    && (!builtin || (x.color === BUSINESS_TEMPLATE.color && x.theme === BUSINESS_TEMPLATE.theme && x.mark === BUSINESS_TEMPLATE.mark));
  return x.kind === 'profile' && hasExactKeys(x, [...keys, 'advice']) && isRecord(x.advice)
    && Object.entries(x.advice).every(([topic, value]) => (PROFILE_TOPICS as readonly string[]).includes(topic) && adviceText(value))
    && (!builtin || Object.keys(x.advice).length === 0);
}

export function isLibrarySelection(x: unknown): x is LibrarySelection {
  if (!isRecord(x) || !isLibraryAsset(x.profile) || x.profile.kind !== 'profile') return false;
  const keys = ['profile'];
  if (Object.hasOwn(x, 'template')) {
    if (!isLibraryAsset(x.template) || x.template.kind !== 'template') return false;
    keys.push('template');
  }
  if (Object.hasOwn(x, 'branding')) {
    if (!x.template || !isRecord(x.branding) || !hasExactKeys(x.branding, ['color', 'theme', 'mark']) || !branding(x.branding)) return false;
    keys.push('branding');
  }
  return hasExactKeys(x, keys);
}

export const isLibraryAssets = (x: unknown): x is LibraryAsset[] => Array.isArray(x) && x.length <= LIBRARY_LIMIT && x.every(isLibraryAsset);
