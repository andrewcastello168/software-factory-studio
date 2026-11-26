# @@NAME@@

This independently runnable project uses Node.js 22.16.0, TypeScript, Express, React, Vite, PostgreSQL, and pnpm 10.13.1.

## Local development

Create a dedicated local PostgreSQL database and role with permission to use and create objects in the migration schema. Copy .env.example to .env and set DATABASE_URL for that database. Keep credentials in .env or your deployment environment.

~~~sh
npm install --global pnpm@10.13.1
pnpm install --frozen-lockfile
cp .env.example .env
# Set DATABASE_URL in .env.
pnpm db:migrate
pnpm dev:api
~~~

For the copy step on PowerShell, use Copy-Item .env.example .env. In a second terminal run pnpm dev:web and open the address printed by Vite. The development proxy directs /api to port @@PORT@@ by default. If the port changes, restart both processes. The API listens on loopback unless HOST is configured.

GET /api/health checks API liveness. GET /api/ready verifies the PostgreSQL connection. The initial migration records the infrastructure baseline in the checksum ledger. Startup leaves migrations to the operator.

@@READMEFEATURES@@## Verification and production

~~~sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
~~~

Set TEST_DATABASE_URL to a disposable PostgreSQL database for integration tests. pnpm start serves the compiled React site and API from the same Express process. Run these commands from the project root.

Read the [architecture](docs/ARCHITECTURE.md), [coding standards](docs/CODING_STANDARDS.md), [requirements](docs/REQUIREMENTS.md), and [dependency notices](docs/DEPENDENCIES.md). Choose suitable application licensing before redistribution.
