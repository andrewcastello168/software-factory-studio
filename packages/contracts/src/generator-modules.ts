import { hasExactKeys, isRecord } from './validation';

export type ApplicationType = 'full-stack' | 'backend-only' | 'frontend-only';
export type DatabaseChoice = 'postgresql' | 'none';

export interface ModuleSelection {
  id: string;
  version: string;
}

interface ModuleDefinition {
  id: string;
  label: string;
  version: string | null;
  appTypes: readonly ApplicationType[];
  databases: readonly DatabaseChoice[];
  requires: readonly string[];
}

export const WELCOME_EXAMPLE = { id: 'welcome-example', version: '1.0.0' } as const;
const fullStackPostgres = { appTypes: ['full-stack'], databases: ['postgresql'] } as const;

export const MODULE_CATALOG: readonly ModuleDefinition[] = [
  { ...WELCOME_EXAMPLE, label: 'Welcome example', ...fullStackPostgres, requires: [] },
  { id: 'authentication', label: 'Authentication', version: null, ...fullStackPostgres, requires: ['user-management'] },
  { id: 'user-management', label: 'User management', version: null, ...fullStackPostgres, requires: [] },
  { id: 'rbac', label: 'RBAC', version: null, ...fullStackPostgres, requires: ['authentication', 'user-management'] },
  { id: 'crud', label: 'CRUD', version: null, ...fullStackPostgres, requires: [] },
  { id: 'audit-logging', label: 'Audit logging', version: null, ...fullStackPostgres, requires: [] },
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
    for (const dependency of module.requires) {
      if (!byId.has(dependency)) messages.push(module.label + ' requires ' + dependency + '.');
    }
  }
  return messages;
}
