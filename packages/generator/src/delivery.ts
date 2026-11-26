import { GO_STACK, GENERATOR_LIMITS, isRecord } from '@factory/contracts';
import type { DeliveryOption, IncrementalChange } from '@factory/contracts';
import { sha256 } from './index';
import type { LocalFile, VersionedProject } from './incremental';

const manifestPath = '.factory/generation-manifest.json';
export const deliveryPaths = ['.github/workflows/factory-verification.yml', 'delivery/verify.sh', 'Dockerfile', '.dockerignore',
  'compose.factory.yaml', 'delivery/container.env.example', 'delivery/healthcheck.go', 'docs/DEPLOYMENT.md'];
export const isDeliveryPath = (path: string) => deliveryPaths.includes(path);
const nodeImage = 'node:22.16.0-bookworm-slim@sha256:048ed02c5fd52e86fda6fbd2f6a76cf0d4492fd6c6fee9e2c463ed5108da0e34';
const goImage = 'golang:1.26.11-bookworm@sha256:ea47ee45f1284d60f9cc09cb2c3bb4f508c256b640bd8bb30342ff13d1adcb52';
const postgres = 'postgres:17-alpine@sha256:f9cf3e1f0066f0eb0c48707d864f0ac5941e9ff454a072077d97a4d278d07d73';
const pnpm = '10.13.1';

function workflow(go: boolean) {
  return `name: Factory verification

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    services:
      postgres:
        image: ${postgres}
        env:
          POSTGRES_DB: factory_ci
          POSTGRES_USER: factory_ci
          POSTGRES_PASSWORD: disposable-factory-ci
        ports: [5432/tcp]
        options: >-
          --health-cmd "pg_isready -U factory_ci -d factory_ci"
          --health-interval 5s --health-timeout 3s --health-retries 12
    steps:
      - uses: actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803
        with:
          persist-credentials: false
      - uses: actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38
        with:
          node-version: '22.16.0'
${go ? `      - uses: actions/setup-go@4dc6199c7b1a012772edbd06daecab0f50c9053c
        with:
          go-version: '1.26.11'
          cache-dependency-path: go.sum
` : ''}      - run: npm install --global pnpm@${pnpm} --no-audit --no-fund
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: bash delivery/verify.sh
        env:
          TEST_DATABASE_URL: postgresql://factory_ci:disposable-factory-ci@127.0.0.1:\${{ job.services.postgres.ports[5432] }}/factory_ci
      - uses: actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f
        with:
          name: development-build
          path: dist/
          if-no-files-found: error
          retention-days: 7
`;
}

function verification(go: boolean) {
  return `#!/usr/bin/env bash
set -euo pipefail

if [[ -n "\${TEST_DATABASE_URL:-}" ]]; then
  if ! node -e 'try { const u = new URL(process.env.TEST_DATABASE_URL); if (!["postgres:", "postgresql:"].includes(u.protocol) || u.hostname !== "127.0.0.1" || !/^\\/factory_[a-z0-9_]+$/.test(u.pathname) || u.hash || (u.search && (u.searchParams.size !== 1 || !/^-csearch_path=[a-z_][a-z0-9_]*$/.test(u.searchParams.get("options") ?? "")))) process.exit(1); } catch { process.exit(1); }'; then
    printf '%s\\n' 'Use a dedicated loopback factory_ verification database.'
    exit 1
  fi
fi

pnpm lint
pnpm typecheck
pnpm audit --prod --audit-level high
${go ? `export GOTOOLCHAIN=local
unformatted=$(gofmt -l cmd internal)
if [[ -n "$unformatted" ]]; then
  printf '%s\\n' "$unformatted"
  exit 1
fi
go mod verify
go vet -mod=readonly ./...
go test -mod=readonly -buildvcs=false ./...
` : 'pnpm test\n'}pnpm build
${go ? `go build -mod=readonly -trimpath -buildvcs=false -o dist/factory-server ./cmd/server
go build -mod=readonly -trimpath -buildvcs=false -o dist/factory-migrate ./cmd/migrate
if [[ -n "${'$'}{TEST_DATABASE_URL:-}" ]]; then
  DATABASE_URL="$TEST_DATABASE_URL" ./dist/factory-migrate
  export DATABASE_URL="$TEST_DATABASE_URL" HOST=127.0.0.1 PORT=43871
  ./dist/factory-server &
  app_pid=$!
  trap 'kill "$app_pid" 2>/dev/null || true' EXIT
  curl --retry 30 --retry-delay 1 --retry-connrefused --max-time 5 --fail --silent http://127.0.0.1:43871/api/ready >/dev/null
fi
` : ''}`;
}

function dockerfile(go: boolean) {
  const frontend = `FROM ${nodeImage} AS manifests
WORKDIR /app
ENV CI=true
RUN npm install --global pnpm@${pnpm} --no-audit --no-fund --fetch-retries=0 --fetch-timeout=20000
COPY package.json pnpm-lock.yaml ./

FROM manifests AS frontend
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY web ./web
COPY vite.config.ts tsconfig.json ./
`;
  if (go) return frontend + `RUN pnpm build

FROM ${goImage} AS backend
ENV GOTOOLCHAIN=local CGO_ENABLED=0
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY cmd ./cmd
COPY internal ./internal
COPY delivery/healthcheck.go ./delivery/healthcheck.go
RUN go build -mod=readonly -trimpath -buildvcs=false -o /out/server ./cmd/server && \\
    go build -mod=readonly -trimpath -buildvcs=false -o /out/migrate ./cmd/migrate && \\
    go build -mod=readonly -trimpath -buildvcs=false -o /out/health ./delivery/healthcheck.go

FROM scratch
WORKDIR /app
COPY --from=backend /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=backend /out/ ./
COPY --from=frontend /app/dist/web ./dist/web
COPY db/migrations ./db/migrations
ENV HOST=0.0.0.0 PORT=3000
USER 65532:65532
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=4 CMD ["/app/health"]
CMD ["/app/server"]
`;
  return frontend + `COPY tsconfig.server.json ./
COPY server ./server
RUN pnpm build

FROM manifests AS production
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM ${nodeImage}
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=frontend /app/package.json ./package.json
COPY --from=production /app/node_modules ./node_modules
COPY --from=frontend /app/dist ./dist
COPY db/migrations ./db/migrations
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=4 CMD ["node","-e","fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node","dist/server/server.js"]
`;
}

const health = `package main

import (
	"net/http"
	"os"
	"strconv"
	"time"
)

func main() {
	port, err := strconv.Atoi(os.Getenv("PORT"))
	if err != nil || port < 1024 || port > 65535 {
		os.Exit(1)
	}
	client := http.Client{
		Timeout: 2 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	response, err := client.Get("http://127.0.0.1:" + strconv.Itoa(port) + "/api/health")
	if err != nil {
		os.Exit(1)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		os.Exit(1)
	}
}
`;

function compose(identity: boolean) {
  return `services:
  database:
    image: ${postgres}
    environment:
      POSTGRES_DB: factory_dev
      POSTGRES_USER: factory_dev
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:?Set a dedicated development password}
    volumes:
      - factory_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "factory_dev", "-d", "factory_dev"]
      interval: 5s
      timeout: 3s
      retries: 12
  app:
    build: .
    ports: ["127.0.0.1:3000:3000"]
    environment:
      DATABASE_URL: \${DATABASE_URL:?Supply a development PostgreSQL URL for the database service}
${identity ? `      AUTH_ORIGIN: http://127.0.0.1:3000
      AUTH_ALLOW_INSECURE_LOOPBACK: '1'
` : ''}    depends_on:
      database:
        condition: service_healthy
volumes:
  factory_data:
`;
}

function deploymentGuide(go: boolean, identity: boolean) {
  return `# Deployment

The **development** Compose example binds the app to localhost and keeps PostgreSQL on the private Compose network. Copy the keys in \`delivery/container.env.example\` to an ignored local \`.env\` or supply them through the environment. The development URL must use host \`database\`, user and database \`factory_dev\`, and the URL-encoded password used for the test instance.

1. Build with \`docker compose -f compose.factory.yaml build\`.
2. Start the disposable database with \`docker compose -f compose.factory.yaml up -d --wait database\`.
3. Review the target and migrations. Apply explicitly with \`docker compose -f compose.factory.yaml run --rm app ${go ? '/app/migrate' : 'node dist/server/migrate.js'}\`.
4. Start the app with \`docker compose -f compose.factory.yaml up -d --wait app\`. Check \`/api/health\` and \`/api/ready\` on port 3000.

Use an isolated **staging** database to verify the image and reviewed migrations before deployment. For **production**, build the image from a clean, approved revision and deploy it under a reviewed TLS ingress. Supply a secret-managed \`DATABASE_URL\` and an environment-specific host and port. Review changes and backups before explicitly running migrations. Never use the development Compose instance for a client database.

Run the container with \`${go ? '/app/server' : 'node dist/server/server.js'}\`. Liveness and readiness are separate. A live server can report PostgreSQL unavailable.
${identity ? `For identity, set \`AUTH_ORIGIN\` to the exact HTTPS origin and omit \`AUTH_ALLOW_INSECURE_LOOPBACK\` outside local development. The trusted proxy must bind to the same network namespace's loopback for the generated proxy policy. Configure and verify TLS termination before external use; the Compose example does not provision TLS or administrator credentials.
` : ''}`;
}

export function deliveryTemplates(project: Pick<VersionedProject, 'config'>, option: DeliveryOption): Record<string, string> {
  const go = project.config.stack === GO_STACK;
  if (option === 'ci') return { [deliveryPaths[0]!]: workflow(go), 'delivery/verify.sh': verification(go) };
  const identity = project.config.modules.some(({ id }) => id === 'authentication');
  return {
    Dockerfile: dockerfile(go),
    '.dockerignore': `**
!Dockerfile
!package.json
!pnpm-lock.yaml
!tsconfig*.json
!vite.config.ts
!web/
!web/**
!db/
!db/migrations/
!db/migrations/**
${go ? '!go.mod\n!go.sum\n!cmd/\n!cmd/**\n!internal/\n!internal/**\n!delivery/\n!delivery/healthcheck.go' : '!server/\n!server/**'}
**/.env*
**/*.pem
**/*.key
**/*.p12
**/*.pfx
**/.npmrc
`,
    'compose.factory.yaml': compose(identity),
    'delivery/container.env.example': 'POSTGRES_PASSWORD=\nDATABASE_URL=\n',
    ...(go ? { 'delivery/healthcheck.go': health } : {}),
    'docs/DEPLOYMENT.md': deploymentGuide(go, identity),
  };
}

export function composeDelivery(project: VersionedProject, files: ReadonlyMap<string, LocalFile>, option: DeliveryOption) {
  const changes: IncrementalChange[] = [];
  const issues: string[] = [];
  const result = { changes, issues, backend: [], frontend: [] };
  const owned = new Map(project.files.map((item) => [item.path, item]));
  for (const [path, content] of Object.entries(deliveryTemplates(project, option))) {
    const local = files.get(path);
    const hash = sha256(content);
    if (local?.state === 'text' && local.sha256 === hash && owned.get(path)?.sha256 === hash) continue;
    if (local?.state !== 'absent' || owned.has(path)) {
      changes.push({ path, action: 'conflict', reason: 'Existing, missing-owned, or unsafe file. Review it in your editor.', before: null, after: null });
      issues.push('Resolve existing delivery files outside Studio before using this create-only template.');
      continue;
    }
    changes.push({ path, action: 'create', reason: 'Publish the reviewed built-in delivery template.', before: null, after: content });
    owned.set(path, { path, sha256: hash, owner: project.config.stack, action: 'create' });
  }
  if (!changes.length || issues.length) return result;
  const source = files.get(manifestPath);
  const manifest: unknown = source?.state === 'text' ? JSON.parse(source.content) : null;
  if (!isRecord(manifest) || source?.state !== 'text' || owned.size > GENERATOR_LIMITS.files) {
    issues.push('The project manifest is unavailable or its ownership limit has been reached.');
    return result;
  }
  changes.push({ path: manifestPath, action: 'modify', reason: 'Record exact ownership of the reviewed delivery files.',
    before: source.content, after: JSON.stringify({ ...manifest, files: [...owned.values()] }, null, 2) + '\n' });
  return result;
}
