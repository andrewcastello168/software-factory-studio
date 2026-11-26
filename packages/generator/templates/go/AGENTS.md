# Project instructions

- This is an independent Go/Gin API with a React/Vite frontend and PostgreSQL.
- Use Go 1.26.11. Run `go vet ./...`, `go test ./...`, and `go build -buildvcs=false ./cmd/...` before submitting backend changes.
- Use Node.js 22.16.0 and pnpm 10.13.1 for the frontend. Run `pnpm lint`, `pnpm typecheck`, and `pnpm build`.
- Read docs/ARCHITECTURE.md and docs/CODING_STANDARDS.md before modifying integrations. Maintain client requirements separately in docs/REQUIREMENTS.md.
- Review the PostgreSQL target and ordered SQL before running the explicit migration command. Never commit credentials.
@@AGENTFEATURES@@
