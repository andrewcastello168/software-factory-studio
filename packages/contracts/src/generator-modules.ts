import { hasExactKeys, isRecord } from './validation';

export type ApplicationType = 'full-stack' | 'backend-only' | 'frontend-only';
export type DatabaseChoice = 'postgresql' | 'none';

export interface ModuleSelection {
  id: string;
  version: string;
}

export interface ModuleDefinition {
  id: string;
  label: string;
  version: string | null;
  appTypes: readonly ApplicationType[];
  databases: readonly DatabaseChoice[];
  requires: readonly string[];
  conflicts?: readonly string[];
  description?: string;
  runtime?: string;
  artifacts?: readonly string[];
  settings?: readonly { name: string; required: boolean; usage: string }[];
}

export const AUTHENTICATION = { id: 'authentication', version: '1.0.0' } as const;
export const USER_MANAGEMENT = { id: 'user-management', version: '1.0.0' } as const;
export const RBAC = { id: 'rbac', version: '1.0.0' } as const;
export const AUDIT_LOGGING = { id: 'audit-logging', version: '1.0.0' } as const;
export const IDENTITY_MODULES: readonly ModuleSelection[] = [AUTHENTICATION, USER_MANAGEMENT, RBAC, AUDIT_LOGGING];
export const WELCOME_EXAMPLE = { id: 'welcome-example', version: '1.0.0' } as const;
const fullStackPostgres = { appTypes: ['full-stack'], databases: ['postgresql'] } as const;

export const MODULE_CATALOG: readonly ModuleDefinition[] = [
  { ...WELCOME_EXAMPLE, label: 'Welcome example', ...fullStackPostgres, requires: [] },
  { ...AUTHENTICATION, label: 'Authentication', ...fullStackPostgres, requires: [], conflicts: [],
    description: 'Local password login and PostgreSQL-backed sessions. Protects generated CRUD and business pages.',
    runtime: 'AUTH_ORIGIN and explicit administrator provisioning',
    settings: [
      { name: 'AUTH_ORIGIN', required: true, usage: 'Exact HTTPS public origin, or explicit local loopback origin' },
      { name: 'AUTH_ALLOW_INSECURE_LOOPBACK', required: false, usage: 'Optional local-only HTTP development switch' },
      { name: 'AUTH_BOOTSTRAP_EMAIL', required: true, usage: 'Bootstrap command only. Supply password through stdin.' },
    ], artifacts: ['Account, session and throttling migrations', 'Authentication API and login gate', 'Tests and identity guide'] },
  { ...USER_MANAGEMENT, label: 'User management', ...fullStackPostgres, requires: ['authentication'], conflicts: [],
    description: 'Manage accounts, activation and password rotation from an authorized workspace.',
    runtime: 'Bootstrap administrator for writes; users.manage permits account listing',
    artifacts: ['Account management API', 'React user administration', 'Tests and identity guide'] },
  { ...RBAC, label: 'RBAC', ...fullStackPostgres, requires: ['authentication', 'user-management'], conflicts: [],
    description: 'Manage roles, permission assignments and server-side record access.',
    runtime: 'Bootstrap administrator controls role and permission assignment', artifacts: ['Role and permission migration', 'Role management API and React page', 'Authorization tests and identity guide'] },
  { id: 'crud', label: 'CRUD', version: null, ...fullStackPostgres, requires: [] },
  { ...AUDIT_LOGGING, label: 'Audit logging', ...fullStackPostgres, requires: ['authentication'], conflicts: [],
    description: 'Persist reviewed identity and administration events without recording credential material.',
    runtime: 'Administrator or audit.read permission', artifacts: ['Audit event migration', 'Read-only inspection API and page', 'Tests and retention guide'] },
  { id: 'reporting', label: 'Reporting', version: null, ...fullStackPostgres, requires: [] },
  { id: 'excel', label: 'Excel import / export', version: null, ...fullStackPostgres, requires: [] },
  { id: 'file-management', label: 'File management', version: null, ...fullStackPostgres, requires: [] },
  { id: 'notifications', label: 'Notifications', version: null, ...fullStackPostgres, requires: [] },
  { id: 'scheduler', label: 'Scheduler', version: null, ...fullStackPostgres, requires: [] },
  { id: 'payments', label: 'Payment integrations', version: null, ...fullStackPostgres, requires: [] },
];

export function isModuleSelection(value: unknown): value is ModuleSelection {
  return isRecord(value) && hasExactKeys(value, ['id', 'version'])
    && typeof value.id === 'string' && /^[a-z][a-z0-9-]{0,47}$/u.test(value.id)
    && typeof value.version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/u.test(value.version);
}

export function moduleCompatibility(appType: ApplicationType, database: DatabaseChoice, selected: readonly ModuleSelection[]): string[] {
  const messages: string[] = [];
  const byId = new Map(selected.map(({ id, version }) => [id, version]));
  if (byId.size !== selected.length) messages.push('Choose each module once.');
  for (const [id, version] of byId) {
    const module = MODULE_CATALOG.find((entry) => entry.id === id);
    if (!module) {
      messages.push('The selection contains an unknown module.');
      continue;
    }
    if (!module.version) messages.push(module.label + ' is planned.');
    else if (version !== module.version) messages.push(module.label + ' has no verified release at that version.');
    if (!module.appTypes.includes(appType) || !module.databases.includes(database)) {
      messages.push(module.label + ' is incompatible with the selected application type or database.');
    }
    for (const conflict of module.conflicts ?? []) if (byId.has(conflict)) messages.push(module.label + ' conflicts with ' + conflict + '.');
    for (const dependency of module.requires) {
      if (!byId.has(dependency)) messages.push(module.label + ' requires ' + dependency + '.');
    }
  }
  return messages;
}

export function orderedModules(selected: readonly ModuleSelection[]): ModuleSelection[] {
  const order: ModuleSelection[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const byId = new Map(selected.map((pin) => [pin.id, pin]));
  function visit(pin: ModuleSelection) {
    if (visiting.has(pin.id)) throw new Error('Cyclic module dependencies.');
    if (visited.has(pin.id)) return;
    visiting.add(pin.id);
    const definition = MODULE_CATALOG.find(({ id }) => id === pin.id);
    if (!definition) throw new Error('Unknown module.');
    for (const id of [...definition.requires].sort()) {
      const dependency = byId.get(id);
      if (!dependency) throw new Error('Missing module dependency.');
      visit(dependency);
    }
    visiting.delete(pin.id);
    visited.add(pin.id);
    order.push(pin);
  }
  for (const id of [...byId.keys()].sort()) visit(byId.get(id)!);
  return order;
}
