# @@NAME@@

Independent Go/Gin application with a React/Vite frontend and PostgreSQL.

## Develop

Use Go 1.26.11 with `GOTOOLCHAIN=local` when verifying the locked toolchain. Use Node.js 22.16.0 and pnpm 10.13.1 for the web toolchain.

1. Run `go mod download`, `go mod verify`, and `pnpm install --frozen-lockfile`.
2. Set `DATABASE_URL` in the process environment. Review .env.example for supported variables. Go reads the process environment directly. Keep the same `PORT` for Go and Vite when overriding the generated default.
3. Review the database target and SQL, then run `go run -mod=readonly -buildvcs=false ./cmd/migrate` explicitly against your development database. Browser startup and server startup do not apply SQL.
4. Run `go run -mod=readonly -buildvcs=false ./cmd/server` and `pnpm dev:web` in separate terminals. Open the Vite URL shown in the terminal.

`GET /api/health` checks the HTTP server. `GET /api/ready` checks PostgreSQL.

## Verify and build

Run `go vet ./...`, `go test ./...`, `pnpm lint`, and `pnpm typecheck`. Format Go changes with `gofmt`. Build assets with `pnpm build` and build the backend with `go build -mod=readonly -buildvcs=false -o factory-server ./cmd/server`. On Windows use `factory-server.exe` for the output. Run the binary from the app root alongside `dist/web`; the production server itself requires no Node.js runtime. Build `./cmd/migrate` separately if distributing a migration executable.

The generated server has no sign-in. Restrict access to an appropriate trusted network or deploy behind separately managed TLS and access controls. Review dependency licenses with `pnpm licenses` and the licenses in the Go module graph. Go dependency versions are recorded in go.mod and go.sum.

@@READMEFEATURES@@
