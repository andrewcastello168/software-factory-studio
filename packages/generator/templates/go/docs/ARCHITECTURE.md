# Go Service architecture

`cmd/server` assembles configuration, the PostgreSQL pool, Gin and graceful HTTP shutdown. `cmd/migrate` explicitly applies reviewed SQL. `internal/platform` owns runtime configuration and the shared PostgreSQL checksum ledger. `internal/httpapp` defines middleware, health/readiness, JSON API routing and the production frontend mount. The React frontend and Vite dev proxy use the same-origin API.

Handlers own HTTP translation. Keep business policy in Go packages under internal and persistence behind context-aware repository calls. The process logs structured request method, status and duration without including request bodies, SQL errors, query parameters or connection strings.

@@ARCHFEATURES@@
