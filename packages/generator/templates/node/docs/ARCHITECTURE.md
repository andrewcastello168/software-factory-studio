# Architecture

The Layered Web architecture profile v1 uses one repository and two entry points. Vite runs web/main.tsx during development and emits the site to dist/web. server/server.ts starts Express and serves the production site and same-origin API. Studio metadata is optional at runtime.

Express routes register handlers in server/routes.ts. Controllers validate requests and choose response codes. The service handles feature decisions, and repositories own PostgreSQL access with parameterized statements. server/config.ts validates process configuration and server/middleware.ts handles structured request events and sanitized errors. Keep simple features in nearby files until actual feature boundaries justify subdirectories.

The ordered SQL files in db/migrations/ are the schema source. The migration runner applies new files in order under an advisory transaction lock and records name and SHA-256 in schema_migrations. Unknown history and changed checksums stop migration. Use new transactional, forward-only statements and review the exact target and SQL before running. Keep migration bytes stable across systems.

The sample welcome feature is deliberately small and has no account or client domain model. Put client behavior in features built on the same conventions. Change browser text, layout, and branding in web/ and keep database details on the server.
