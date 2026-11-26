import { BUILTIN_LIBRARY, GO_STACK, isLibraryAssets, MODULE_CATALOG, NODE_STACK, STACKS } from '@factory/contracts';
import type { LibraryAsset, SharedOverview } from '@factory/contracts';
import { sha256 } from './index';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}

export const canonicalAsset = (asset: LibraryAsset) => JSON.stringify(canonical(asset));
const compatible = [NODE_STACK, GO_STACK];
const references = {
  stacks: compatible.map((id) => ({ id, version: STACKS[id as keyof typeof STACKS].version,
    architecture: STACKS[id as keyof typeof STACKS].architecture, digest: sha256(JSON.stringify(STACKS[id as keyof typeof STACKS])) })),
  modules: MODULE_CATALOG.filter((item) => item.version).map((item) => ({ id: item.id, version: item.version, digest: sha256(JSON.stringify(item)) })),
  ci: 'factory-verification-v1',
  deployment: 'factory-docker-v1',
};

export function sharedBundle(assets: LibraryAsset[]) {
  if (!isLibraryAssets(assets) || !assets.length || assets.length > 8 || assets.some(({ id }) => BUILTIN_LIBRARY.some((item) => item.id === id))
    || new Set(assets.map(({ id, version }) => id + ':' + version)).size !== assets.length) throw new Error('Unsupported shared assets.');
  const ordered = [...assets].sort((a, b) => a.id.localeCompare(b.id, 'en') || a.version - b.version);
  const content = JSON.stringify(canonical({
    format: 'factory-library', version: 1, compatibility: compatible, references,
    assets: ordered.map((asset) => ({ digest: sha256(canonicalAsset(asset)), asset })),
  }), null, 2) + '\n';
  const digest = sha256(content);
  const overview: SharedOverview = { digest, assets: ordered.map(({ id, version, name, kind }) => ({ id, version, name, kind })) };
  return { content, digest, overview, assets: ordered };
}

export function readSharedBundle(content: string) {
  const data: unknown = JSON.parse(content);
  if (data === null || typeof data !== 'object' || !('assets' in data) || !Array.isArray(data.assets) || data.assets.length > 8) {
    throw new Error('Invalid shared bundle.');
  }
  const assets = data.assets.map((value: unknown) =>
    value && typeof value === 'object' && 'asset' in value ? value.asset : null);
  if (!isLibraryAssets(assets)) throw new Error('Invalid shared definitions.');
  const rebuilt = sharedBundle(assets);
  if (rebuilt.content !== content) throw new Error('Bundle digests, dependencies, or compatibility differ from the supported envelope.');
  return rebuilt;
}
