# @@NAME@@

This standalone application uses Node.js 22.16.0, TypeScript, Express, React, Vite, PostgreSQL, and pnpm 10.13.1.

## Local development

Create a dedicated PostgreSQL database and least-privilege login with access to that database and permission to create tables in its application schema. Copy .env.example to .env and set DATABASE_URL to the connection string for the database you reviewed. The sample connection is local. Supply your own credentials and keep .env out of version control.

~~~sh
npm install --global pnpm@10.13.1
pnpm install --frozen-lockfile
cp .env.example .env
# Edit DATABASE_URL in .env before continuing.
pnpm db:migrate
pnpm dev:api
~~~

On PowerShell, use Copy-Item .env.example .env for the copy step. In a second terminal run pnpm dev:web and open the address Vite prints. Vite proxies /api to the API on port @@PORT@@ by default. Restart both processes when changing PORT. The API listens on loopback unless HOST is explicitly configured.

GET /api/health verifies API liveness. GET /api/welcome (or ?variant=short) retrieves a seeded message from PostgreSQL. This starter applies no migrations on startup.

## Verification and production

~~~sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm start
~~~

Set TEST_DATABASE_URL to a dedicated disposable PostgreSQL database to include the database test. The test applies the initial committed migration and is skipped explicitly when this setting is absent. Test credentials and application credentials should use different databases. pnpm start serves the built React site and its API from the same Express process. Run commands from the project root.

See the [architecture](docs/ARCHITECTURE.md), [coding standards](docs/CODING_STANDARDS.md), [requirements](docs/REQUIREMENTS.md), and [dependency notices](docs/DEPENDENCIES.md). Choose an application license or client ownership terms before redistribution.
