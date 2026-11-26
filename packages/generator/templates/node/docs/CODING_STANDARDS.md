# Coding standards

Standard Engineering profile v1 applies to the generated baseline. Each project owns its copy. Later profile versions apply to new projects through deliberate selection.

- Use strict TypeScript, lower camel case for functions and values, PascalCase for React components and types, and lower-case file names. Give migrations four-digit stable sequence prefixes.
- Validate request parameters before invoking a service. Respond with a data object for success and an error object with a stable code and a human-readable message for failure. Route misses use 404, invalid input 400, and unconfigured database access 503.
- Parameterize all data values in SQL. Use dedicated database credentials and review new migration SQL. Keep applied migration files immutable.
- Load environment settings at startup. Keep secrets in local environment or deployment configuration. Log operation labels, methods, status and duration without connection strings, raw exception text, headers, or request bodies.
- Use same-origin requests and Helmet headers. Add deliberate client-specific authentication or authorization when a feature needs it. Plan deployment TLS and database permissions outside this local starter.
- Add automated HTTP tests for validation and failure cases. Use a disposable database for persistence behavior. Run lint, typecheck, test and build before delivery.
