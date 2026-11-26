export const NODE_STACK = 'node-express-react-postgres';
export const GO_STACK = 'go-gin-react-postgres';
export const STACK_SDK_VERSION = 1;

const shared = {
  projectType: 'full-stack', database: 'postgresql', architectureVersion: '1.0.0',
  engineering: 'standard-engineering', engineeringVersion: '1.0.0',
  frontend: 'React 19.3.1 · TypeScript 6.0.3 · Vite 8.3.8',
  databaseRuntime: 'PostgreSQL 17', template: 'Business Workspace v1',
  migrationDirectory: 'db/migrations', migrationLedger: 'schema_migrations',
  capabilities: { scaffold: true, schema: true, crud: true, incrementalCrud: true } as const,
} as const;

export const STACKS = {
  [NODE_STACK]: {
    ...shared, id: NODE_STACK, label: 'Node.js · TypeScript · Express · React · Vite · PostgreSQL',
    version: '2.0.0', architecture: 'layered-web', architectureLabel: 'Layered Web · v1',
    backend: 'Node.js 22.16.0 · TypeScript 6.0.3 · Express 5.2.1 · pg 8.22.0',
    runtime: 'Node.js 22.16.0 · pnpm 10.13.1', modules: true,
    manifests: ['package.json', 'pnpm-lock.yaml'],
    verify: ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build'],
    unsupported: 'Backend-only and frontend-only generation are unavailable.',
  },
  [GO_STACK]: {
    ...shared, id: GO_STACK, label: 'Go · Gin · React · Vite · PostgreSQL',
    version: '1.0.0', architecture: 'go-service', architectureLabel: 'Go Service · v1',
    backend: 'Go 1.26.11 · Gin 1.12.0 · pgx 5.13.0',
    runtime: 'Go 1.26.11 · Node.js 22.16.0 and pnpm 10.13.1 for the frontend build',
    modules: false, manifests: ['go.mod', 'go.sum', 'package.json', 'pnpm-lock.yaml'],
    verify: ['go mod verify', 'go vet ./...', 'go test ./...', 'go build -buildvcs=false ./cmd/...', 'pnpm lint', 'pnpm typecheck', 'pnpm build'],
    unsupported: 'Welcome and identity modules, stack conversion, and backend-only or frontend-only generation are unavailable.',
  },
} as const;
export type StackId = keyof typeof STACKS;
export type StackArchitecture = typeof STACKS[StackId]['architecture'];

export function stackDefinition(id: unknown) {
  return id === NODE_STACK || id === GO_STACK ? STACKS[id] : undefined;
}
