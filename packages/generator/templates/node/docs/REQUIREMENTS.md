# @@NAME@@ requirements

- Serve a React page that reads a persisted welcome message through the same-origin Express API.
- Provide an API liveness endpoint that stays independent of database readiness.
- Provide an explicit, repeatable initial PostgreSQL migration and preserve applied migration checksums.
- Support frozen dependency installation, isolated local development and a standalone production build.
- Document development and delivery conventions for people and coding assistants.

## Project-specific requirements

Record client workflows, data ownership, access rules, acceptance scenarios and deployment targets here as they are agreed. Review their effect on code and migrations before changing the starter.
