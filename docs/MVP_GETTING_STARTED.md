# Use the Engineering Library for a client application

1. Open **Engineering Standards** in Studio. Duplicate Standard Engineering or create a personal profile. Enter only reusable guidance and preview its next version before publishing. Use the JSON panel to share an approved definition with your team. A pasted definition becomes a new personal draft.
2. Open **Template Studio** to preview or duplicate Business Workspace. Choose a theme, primary color and short brand mark. Project-level changes stay with that project.
3. Choose **New Project** and set the client's project name and location. Select the verified Layered Web stack, exact profile version and optional template. Enter the client branding and schema, or import supported PostgreSQL DDL and select eligible CRUD tables.
4. Choose optional identity modules explicitly. Authentication enables local sign-in. User Management and Audit Logging require Authentication. RBAC requires Authentication and User Management. The Foundation layout and no-login generation remain supported.
5. Review the exact files, SQL, locks, and engineering instructions. Confirm the plan when the scope matches your intent. Open the output in Studio or VS Code. Keep client requirements in the project's own `docs/REQUIREMENTS.md`.
6. Work from the generated project's README. Run `pnpm install --frozen-lockfile` using the pinned toolchain. Set `DATABASE_URL` in your local environment and review the disposable or development target before running `pnpm db:migrate`. Apply migrations through the project's own tools.
7. For identity-enabled projects, configure `AUTH_ORIGIN` and follow `docs/IDENTITY.md` to provision the first administrator from stdin. For local Vite preview, use the configured loopback URL and the explicit development HTTP switch. Production uses a trusted HTTPS proxy and secure cookies.
8. Run `pnpm test` and `pnpm build`, then run the generated project with its ordinary package scripts. Review and commit the client project separately from the central library.

For an existing compatible project, open **Generation Review**, expand **Install optional modules**, and select the releases and required dependencies. Inspect the source and migration changes before approving. Resolve reported custom entrypoint conflicts manually. Use the recovery record if publication is interrupted. Apply the appended SQL only when you have reviewed the target database.

The Go/Gin starter supports the same approved PostgreSQL and React workflow using the Go Service architecture. Its identity modules are unavailable. See the [stack matrix](STACK_PLUGIN_SDK.md#built-in-sdk-v1) and [client delivery guide](CLIENT_DELIVERY.md) to verify, package and deploy either generated stack.
