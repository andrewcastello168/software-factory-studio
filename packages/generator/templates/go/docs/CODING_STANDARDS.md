# Coding standards

- Use idiomatic, short Go package names and keep main packages focused on process assembly.
- Pass context.Context explicitly from incoming requests to database calls. Set timeouts at the HTTP and database boundaries.
- Keep handlers responsible for JSON and statuses, services for validation and business decisions, and repositories for parameterized queries.
- Use transactions for multi-statement business mutations. Defer rollback until commit succeeds. Use the migration ledger for ordered SQL releases.
- Wrap errors for internal control flow and return sanitized public error envelopes. Log structured events without credentials, SQL values or payloads.
- Format with gofmt, run go vet and use table-driven tests for validation. Keep React TypeScript strict and use the same-origin API.
- Store credentials in the process environment. Review SQL and schema changes before running the explicit migration command.
