# @@NAME@@

- Use Standard Engineering profile v1, Node.js 22.16.0 and pnpm 10.13.1.
- Run pnpm install --frozen-lockfile, pnpm lint, pnpm typecheck, pnpm test, and pnpm build before delivery.
- Put browser code in web/ and Express features in server/. Organize business features with controllers, services, and repositories as needed.
- Validate requests, parameterize SQL, and keep secrets and request bodies out of logs.
- Append applied schema changes through ordered files under db/migrations/. Review the target before applying migrations.
- Keep client requirements and branding in ordinary project files. Apply the documented standards when adding features.
@@AGENTFEATURES@@- See [Architecture](docs/ARCHITECTURE.md), [Coding standards](docs/CODING_STANDARDS.md), and [Requirements](docs/REQUIREMENTS.md).
