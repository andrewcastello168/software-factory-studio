# Architecture

Layered Web v1 uses one repository with independent web and API entry points. Vite runs web/main.tsx in development and compiles browser assets into dist/web. server/server.ts starts Express and serves those assets and the same-origin API in production. Studio metadata is optional at runtime.

server/routes.ts registers API handlers before its final 404. Compose feature handlers there. Controllers validate input and map service decisions to response codes. Repositories own parameterized SQL. Keep feature code together and use separate layers when they carry distinct responsibilities. server/config.ts validates environment configuration, and server/middleware.ts records bounded request events and sanitized failures.

The initial SQL migration describes the ledger baseline in schema_migrations. That ledger stores ordered migrations and SHA-256 fingerprints. Add future SQL under db/migrations/, review the target and use transactional, forward-only changes. PostgreSQL connectivity is checked by GET /api/ready.

Place client behavior in client-owned features and client appearance in web/styles.css and the React components. The foundation defines engineering conventions. Record the product domain and acceptance rules in [Requirements](REQUIREMENTS.md).
@@ARCHFEATURES@@
