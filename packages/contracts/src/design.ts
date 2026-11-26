import type { Result } from './index';
import { httpMethods, isApiPath, isWorkspacePath } from './developer';
import type { HttpMethod } from './developer';
import { isGeneratorDigest } from './generator';
import { isSchemaName } from './schema';
import { hasExactKeys, isRecord } from './validation';

export const DESIGN_PATH = '.factory/developer-design.json';
export const DESIGN_CHANNEL = { inspect: 'factory:developer-design', export: 'factory:developer-design-export' } as const;
export const designKinds = ['api', 'page', 'requirement', 'workflow'] as const;
export type ArtifactKind = 'table' | 'api' | 'page' | 'source' | 'requirement';
export interface ArtifactLink { kind: ArtifactKind; target: string }
export type DesignEntry = { id: string; title: string } & (
  | { kind: 'api'; method: HttpMethod; path: string; query: string[]; request: string; response: string;
    auth: 'none' | 'session'; permission: string; source: string }
  | { kind: 'page'; layout: 'summary' | 'table'; api: string; columns: string[]; description: string }
  | { kind: 'requirement'; description: string; criteria: string; links: ArtifactLink[] }
  | { kind: 'workflow'; description: string; steps: { title: string; links: ArtifactLink[] }[] }
);
export interface DesignMutation { entry: DesignEntry; generate: boolean }
export interface DesignRecord { entry: DesignEntry; references: { link: ArtifactLink; digest: string | null }[] }
export interface DesignDocument { version: 1; records: DesignRecord[] }
export interface DesignSnapshot {
  entries: { entry: DesignEntry; state: 'planned' | 'implemented' | 'changed'; source: string | null;
    links: { link: ArtifactLink; state: 'current' | 'missing' | 'changed' }[] }[];
  generated: Extract<DesignEntry, { kind: 'api' }>[];
}
export interface DesignBridge {
  inspect(id: string): Promise<Result<DesignSnapshot>>;
  export(id: string): Promise<Result<boolean>>;
}

export function formatOpenApi(entries: DesignSnapshot['generated']) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const entry of entries) {
    const operations = paths[entry.path] ??= {};
    operations[entry.method.toLowerCase()] = {
      summary: entry.title,
      parameters: entry.query.map((name) => ({ name, in: 'query', schema: { type: 'string' } })),
      ...(entry.request ? { requestBody: { description: entry.request, content: { 'application/json': { schema: {} } } } } : {}),
      responses: { default: { description: entry.response || 'Response contract is pending.' } },
      ...(entry.auth === 'session' ? { security: [{ localSession: [] }, { secureSession: [] }] } : {}),
      ...(entry.permission ? { 'x-required-permission': entry.permission } : {}),
    };
  }
  return JSON.stringify({
    openapi: '3.1.0', info: { title: 'Workspace API designs', version: '1.0.0' }, paths,
    components: { securitySchemes: {
      localSession: { type: 'apiKey', in: 'cookie', name: 'factory_local_session' },
      secureSession: { type: 'apiKey', in: 'cookie', name: '__Host-factory_session' },
    } },
  }, null, 2) + '\n';
}

const shape = (x: unknown, keys: string[]): x is Record<string, unknown> => isRecord(x) && hasExactKeys(x, keys);
const text = (x: unknown, max = 600): x is string => typeof x === 'string' && x.length <= max && !x.includes('\0')
  && !/(?:postgres(?:ql)?:\/\/|-----BEGIN [A-Z ]+PRIVATE KEY-----|\bBearer\s+\S{8,}|\b(?:password|secret|token|api[_-]?key)\s*[:=]\s*\S{8,})/iu.test(x);
const title = (x: unknown): x is string => text(x, 100) && Boolean(x.trim()) && !/[\r\n]/u.test(x);
const slug = (x: unknown): x is string => typeof x === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(x) && x.length <= 40;
const values = <T>(x: unknown, max: number, valid: (item: unknown) => item is T): x is T[] =>
  Array.isArray(x) && x.length <= max && x.every(valid);
const source = (path: unknown): path is string => isWorkspacePath(path) && !path.split('/').some((part) => /^\.env(?:\.|$)/iu.test(part));
const field = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,47}$/u.test(x);
function link(x: unknown): x is ArtifactLink {
  return shape(x, ['kind', 'target']) && (x.kind === 'table' ? isSchemaName(x.target) : x.kind === 'source' ? source(x.target)
    : (x.kind === 'api' || x.kind === 'page' || x.kind === 'requirement') && slug(x.target));
}
const step = (x: unknown): x is { title: string; links: ArtifactLink[] } =>
  shape(x, ['title', 'links']) && title(x.title) && values(x.links, 8, link);

export function isDesignEntry(x: unknown): x is DesignEntry {
  if (!isRecord(x) || !slug(x.id) || !title(x.title)) return false;
  const common = ['id', 'kind', 'title'];
  if (x.kind === 'api') return hasExactKeys(x, [...common, 'method', 'path', 'query', 'request', 'response', 'auth', 'permission', 'source'])
    && (httpMethods as readonly unknown[]).includes(x.method) && isApiPath(x.path) && values(x.query, 12, field)
    && text(x.request, 400) && text(x.response, 400) && (x.auth === 'none' || x.auth === 'session')
    && (x.permission === '' || field(x.permission)) && (x.source === '' || source(x.source));
  if (x.kind === 'page') return hasExactKeys(x, [...common, 'layout', 'api', 'columns', 'description'])
    && (x.layout === 'summary' || x.layout === 'table') && (x.api === '' || slug(x.api))
    && values(x.columns, 12, field) && new Set(x.columns).size === x.columns.length && text(x.description);
  if (x.kind === 'requirement') return hasExactKeys(x, [...common, 'description', 'criteria', 'links'])
    && text(x.description) && text(x.criteria) && values(x.links, 12, link);
  return x.kind === 'workflow' && hasExactKeys(x, [...common, 'description', 'steps'])
    && text(x.description) && values(x.steps, 12, step) && x.steps.length > 0;
}
export const isDesignMutation = (x: unknown): x is DesignMutation =>
  shape(x, ['entry', 'generate']) && isDesignEntry(x.entry) && typeof x.generate === 'boolean' && (!x.generate || x.entry.kind === 'page');
const reference = (x: unknown): x is DesignRecord['references'][number] =>
  shape(x, ['link', 'digest']) && link(x.link) && (x.digest === null || isGeneratorDigest(x.digest));
const record = (x: unknown): x is DesignRecord =>
  shape(x, ['entry', 'references']) && isDesignEntry(x.entry) && values(x.references, 96, reference);
export const isDesignDocument = (x: unknown): x is DesignDocument =>
  shape(x, ['version', 'records']) && x.version === 1 && values(x.records, 40, record)
  && new Set(x.records.map(({ entry }) => entry.kind + ':' + entry.id)).size === x.records.length;
const resolvedLink = (x: unknown): x is DesignSnapshot['entries'][number]['links'][number] =>
  shape(x, ['link', 'state']) && link(x.link) && (x.state === 'current' || x.state === 'missing' || x.state === 'changed');
const status = (x: unknown): x is DesignSnapshot['entries'][number] =>
  shape(x, ['entry', 'state', 'source', 'links']) && isDesignEntry(x.entry)
  && (x.state === 'planned' || x.state === 'implemented' || x.state === 'changed')
  && (x.source === null || isWorkspacePath(x.source)) && values(x.links, 96, resolvedLink);
const api = (x: unknown): x is DesignSnapshot['generated'][number] => isDesignEntry(x) && x.kind === 'api';
export const isDesignSnapshot = (x: unknown): x is DesignSnapshot =>
  shape(x, ['entries', 'generated']) && values(x.entries, 40, status) && values(x.generated, 162, api);
