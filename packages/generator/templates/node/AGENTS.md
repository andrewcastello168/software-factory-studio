# @@NAME@@

- This project uses the versioned Standard Engineering profile v1. Use Node.js 22.16.0 and pnpm 10.13.1.
- Run pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm test, and pnpm build before delivery.
- Put browser features in web/ and Express HTTP handling in server/. Keep SQL in repositories and ordered schema changes in db/migrations/.
- Use the documented HTTP data and error envelopes. Validate request input at the route boundary, parameterize SQL, and keep credentials and request bodies out of logs.
- Preserve client-specific requirements and code. Extend applied migrations with a new file. Obtain approval before running migrations against a non-disposable database.
- Read [Architecture](docs/ARCHITECTURE.md), [Coding standards](docs/CODING_STANDARDS.md), and [Requirements](docs/REQUIREMENTS.md) before changing related behavior.
