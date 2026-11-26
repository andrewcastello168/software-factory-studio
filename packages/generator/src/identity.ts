import { AUDIT_LOGGING, AUTHENTICATION, RBAC, USER_MANAGEMENT } from '@factory/contracts';
import type { ModuleSelection } from '@factory/contracts';
import authenticationSql from '../templates/identity/db/authentication.sql?raw';
import rbacSql from '../templates/identity/db/rbac.sql?raw';
import auditSql from '../templates/identity/db/audit_logging.sql?raw';
import authentication from '../templates/identity/server/authentication.ts?raw';
import password from '../templates/identity/server/password.ts?raw';
import shared from '../templates/identity/server/shared.ts?raw';
import bootstrap from '../templates/identity/server/bootstrap.ts?raw';
import register from '../templates/identity/server/register.ts?raw';
import users from '../templates/identity/server/users.ts?raw';
import roles from '../templates/identity/server/rbac.ts?raw';
import audit from '../templates/identity/server/audit.ts?raw';
import gate from '../templates/identity/web/IdentityGate.tsx?raw';
import client from '../templates/identity/web/client.ts?raw';
import usersPage from '../templates/identity/web/Users.tsx?raw';
import rolesPage from '../templates/identity/web/Roles.tsx?raw';
import auditPage from '../templates/identity/web/Audit.tsx?raw';
import css from '../templates/identity/web/identity.css?raw';
import accessTests from '../templates/identity/test/access.test.ts?raw';
import tests from '../templates/identity/test/identity.test.ts?raw';

type Template = readonly [string, string];
const server = (name: string, text: string): Template => ['server/features/identity/' + name, text];
const web = (name: string, text: string): Template => ['web/features/identity/' + name, text];
export const IDENTITY_PREFIX = 'factory_identity_';

export const identityContributions = [{
  ...AUTHENTICATION,
  migration: ['authentication', authenticationSql] as const,
  templates: [
    server('authentication.ts', authentication), server('password.ts', password), server('shared.ts', shared),
    server('bootstrap.ts', bootstrap), server('register.ts', register), web('IdentityGate.tsx', gate),
    web('client.ts', client), web('identity.css', css), ['test/identity.test.ts', tests] as const, ['test/identity-access.test.ts', accessTests] as const,
  ],
  tests: ['test/identity.test.ts', 'test/identity-access.test.ts'],
  slots: {
    APIIMPORTS: "import { registerIdentity } from './features/identity/register.ts';\n",
    APIROUTES: '  registerIdentity(router, pool);\n',
    WEBIMPORTS: "import { IdentityGate, RecordAccess } from './features/identity/IdentityGate.tsx';\n",
    AGENTFEATURES: '- Read docs/IDENTITY.md before editing account routes or application access controls.\n',
    READMEFEATURES: '## Sign-in\n\nFollow [Identity](docs/IDENTITY.md) to configure the app origin and provision the first administrator.\n\n',
    ARCHFEATURES: '\nThe identity module integrates an Express guard before generated business routes and a React gate around the app. See docs/IDENTITY.md.\n',
    REQFEATURES: '- Generated pages and business API routes require an active local account.\n',
  },
}, {
  ...USER_MANAGEMENT, templates: [server('users.ts', users), web('Users.tsx', usersPage)],
  tests: ['test/identity-access.test.ts'], slots: { REQFEATURES: '- Authorized operators can create and administer local accounts.\n' },
}, {
  ...RBAC, migration: ['rbac', rbacSql] as const,
  templates: [server('rbac.ts', roles), web('Roles.tsx', rolesPage)],
  tests: ['test/identity-access.test.ts'], slots: { REQFEATURES: '- The administrator can assign roles and record access permissions.\n' },
}, {
  ...AUDIT_LOGGING, migration: ['audit_logging', auditSql] as const,
  templates: [server('audit.ts', audit), web('Audit.tsx', auditPage)],
  tests: ['test/identity-access.test.ts'], slots: { REQFEATURES: '- Authorized operators can inspect supported identity and administrative audit events.\n' },
}];

export function identityMigration(name: string) {
  for (const item of identityContributions) {
    if ('migration' in item && item.migration[0] === name) return item.migration[1].replaceAll('\r\n', '\n');
  }
  return undefined;
}

export function identityValues(modules: readonly ModuleSelection[]) {
  const has = (id: string) => modules.some((pin) => pin.id === id);
  const user = has(USER_MANAGEMENT.id);
  const role = has(RBAC.id);
  const audit = has(AUDIT_LOGGING.id);
  return {
    IDENTITYIMPORTS: (user ? "import { registerUsers } from './users.ts';\n" : '')
      + (role ? "import { readPermissions, registerRoles } from './rbac.ts';\n" : '')
      + (audit ? "import { recordAudit, registerAudit } from './audit.ts';\n" : ''),
    AUDITFALLBACK: audit ? '' : "import { noAudit } from './shared.ts';",
    IDENTITYAUDITOR: audit ? 'recordAudit' : 'noAudit',
    IDENTITYPERMISSIONS: role ? 'async (id) => pool ? readPermissions(pool, id) : []' : 'async () => []',
    IDENTITYRBAC: String(role),
    IDENTITYUSERS: String(user),
    IDENTITYAUDIT: String(audit),
    IDENTITYPERMISSIONSLIST: JSON.stringify(['crud.read', 'crud.write', 'users.manage', ...(audit ? ['audit.read'] : [])]),
    IDENTITYROUTES: (user ? '  registerUsers(router, pool, audit);\n' : '') + (role ? '  registerRoles(router, pool, audit);\n' : '')
      + (audit ? '  registerAudit(router, pool);\n' : ''),
    IDENTITYWEBIMPORTS: (user ? "import { Users } from './Users.tsx';\n" : '') + (role ? "import { Roles } from './Roles.tsx';\n" : '')
      + (audit ? "import { AuditLog } from './Audit.tsx';\n" : ''),
    IDENTITYPAGES: (user ? "  if (allowed(actor, 'users.manage')) pages.push({ id: 'users', label: 'Users', content: <Users editable={actor.administrator} /> });\n" : '')
      + (role ? "  if (actor.administrator) pages.push({ id: 'roles', label: 'Roles', content: <Roles /> });\n" : '')
      + (audit ? "  if (allowed(actor, 'audit.read')) pages.push({ id: 'audit', label: 'Audit log', content: <AuditLog /> });\n" : ''),
  };
}

export function identityGuide(modules: readonly ModuleSelection[]) {
  const names = modules.map(({ id, version }) => '- ' + id + ' · ' + version).join('\n');
  const has = (id: string) => modules.some((pin) => pin.id === id);
  return '# Application identity\n\n' + names + '\n\n'
    + 'Apply the committed migrations on your authorized development database first. Set DATABASE_URL and AUTH_ORIGIN in .env. '
    + 'AUTH_ORIGIN must match the public HTTPS browser origin. For local Vite, use an explicit loopback IP origin and set AUTH_ALLOW_INSECURE_LOOPBACK=1. '
    + 'Keep the backend on loopback behind a TLS-terminating trusted proxy in production. The proxy must overwrite X-Forwarded-Proto and X-Forwarded-For with https and the client address. Use a single configured browser origin.\n\n'
    + 'Set AUTH_BOOTSTRAP_EMAIL in the provisioning process and pipe the initial password from a secret manager into stdin. Run '
    + '`pnpm exec node --env-file-if-exists=.env --experimental-strip-types server/features/identity/bootstrap.ts`. '
    + 'The command provisions one administrator under a database lock and rejects subsequent bootstrap attempts. Keep credentials out of files and command arguments.\n\n'
    + 'Sessions use opaque random tokens hashed at rest, an eight-hour lifetime, HttpOnly SameSite=Strict cookies, and exact Origin checks for unsafe requests. '
    + 'Production cookies use Secure and a host prefix. Login attempts are bounded by account and connection address. '
    + 'Deploy infrastructure rate limits where clients share a proxy address. Remove expired sessions and throttle rows regularly using your database maintenance process.\n\n'
    + (has(USER_MANAGEMENT.id) ? 'The bootstrap administrator may manage ordinary accounts. Delegated users.manage permission grants read access to user listings. Password rotations and deactivation revoke their sessions. The bootstrap administrator is outside these endpoints.\n\n' : '')
    + (has(RBAC.id) ? 'Only the bootstrap administrator can manage roles and assignments. Permissions cover record reads, record writes and user listing. When Audit Logging is installed, audit.read delegates its inspection. Express guards enforce these permissions.\n\n' : '')
    + (has(AUDIT_LOGGING.id) ? 'Audit covers identity sessions and committed user and role changes when those modules are enabled. CRUD success auditing is best-effort after a successful response. '
      + 'Events contain an action, resource, timestamp, actor and identity target IDs where available. Generated CRUD events record table names without record values. Set a retention policy. Custom business operations require explicit instrumentation.\n' : '');
}

export function protectCrudTemplate(path: string, content: string) {
  if (path !== 'web/features/crud/Crud.tsx') return content;
  return content.replace('function Records({ table }: { table: Table })', 'function Records({ table, readOnly }: { table: Table; readOnly: boolean })')
    .replace('export function CrudWorkspace()', 'export function CrudWorkspace({ readOnly = false }: { readOnly?: boolean })')
    .replaceAll('disabled={saving || Boolean(editing || deleting)}', 'disabled={readOnly || saving || Boolean(editing || deleting)}')
    .replace('<Records key={active} table={table} />', '<Records key={active} table={table} readOnly={readOnly} />')
    .replace('This application has unauthenticated data routes. Deploy it with appropriate network and access controls.',
      'Record access depends on your signed-in account.');
}
