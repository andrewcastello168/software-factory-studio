# Developer workspace

Open a project or registered worktree and select **Developer Tools**. All actions use that tab's physical directory and window grant.

## VS Code and terminals

Choose the project root, a listed folder, or a source file. The editor accepts a one-based line and optional column for files. Clearing the line clears the column. The Project Structure tree also has editor and file-manager actions next to source files. Studio discovers VS Code in platform installation locations. Use **Choose VS Code** to select and approve an alternate executable for the current Studio window. Install VS Code separately. Editor and terminal startup may run their normal user settings or extensions. Use VS Code Workspace Trust for unfamiliar repositories.

**Open Terminal** hands off to Windows Command Prompt with AutoRun disabled, or a supported installed Linux terminal. Studio supplies the selected directory and no project command. Embedded terminals and debugger attachment are outside this phase. Install the desktop tools separately if they are unavailable.

For parallel VS Code or Codex sessions, create separate Git worktrees from Git Studio, open each physical path as its own workspace, and configure one local PostgreSQL database or schema and different ports for each. Branch switching never runs migrations. Git worktrees isolate checked-out files, while processes and database instances remain subject to the user's operating system and database configuration.

## Runtime

Toolchains checks native Git, Node.js, pnpm, and Go using their own version commands. It shows the pinned runtime requirements, manifest presence and configuration keys declared in `.env.example`. Project opening does not execute project code. Studio requires the matching Node.js or Go version for the selected command. It runs the reviewed built-in command definitions from the active worktree after a native confirmation:

| Action | Node.js/Express | Go/Gin |
| --- | --- | --- |
| Backend | Node.js 22.16.0 with `--experimental-strip-types server/server.ts` | Go 1.26.11 with `run -mod=readonly -buildvcs=false ./cmd/server` |
| Frontend | Node launches the project's Vite binary with loopback host, chosen port and strict port selection | Same |
| Build | Project TypeScript compiler with `-p tsconfig.server.json`, followed by Vite build | Vite build, followed by `go build -mod=readonly -buildvcs=false ./cmd/...` |
| Test | Node test runner with the reviewed generated test entry points | `go test -mod=readonly -buildvcs=false ./...` |

Install locked project dependencies with `pnpm install --frozen-lockfile` in a trusted terminal before running frontend or build workflows. Go tooling may use its ordinary module cache and dependency network access. Studio's Runtime test action supplies a local development connection to the application when configured. Use the generated project's standalone verification commands to supply a disposable `TEST_DATABASE_URL` for tests that require it.

For local configuration, use **Review .env Creation** to publish a new `.env` with a chosen non-secret port. Studio preserves existing files. Use the editor to set other keys. Runtime reads `HOST`, `PORT`, `DATABASE_URL`, `AUTH_ORIGIN`, and `AUTH_ALLOW_INSECURE_LOOPBACK` from the local configuration. It forces the backend host to IPv4 loopback, takes the backend port from local `.env` or the pinned default, and accepts a loopback PostgreSQL URL. An optional PostgreSQL `options=-csearch_path=<schema>` query value can select a named development schema. Production environment management and automatic database writes are outside this phase.

Runtime commands run with the operating system account's permissions. Native approval applies to a specific command preview, workspace directory identity, Git context and relevant file and executable fingerprints. Save editor buffers first. Project code may access the filesystem or network through the operating system. Studio neither confines that code nor resolves unrelated port owners. Stop controls act on Studio-owned processes. Restart goes through a fresh review. A stopped or closed workspace cannot reuse its prior approvals. Expected readiness comes from supported backend and Vite startup output.

Standard output, standard error and Studio diagnostics are bounded to 200 lines per task. Filter by process, text and stream, then copy visible rows or clear the selected buffer. Logs are in memory. Redaction covers known configuration values and recognizable secret patterns. Output can still contain sensitive values in encodings or formats Studio does not recognize. Review it before sharing.

## API design and local requests

Save a title, method, `/api/…` path, query names, request and validation notes, response contract, authentication and permission metadata, and an optional workspace-relative source link. Studio reports built-in routes using the installed CRUD locks and matching source fingerprints. Custom declarations remain designs until supported implementation evidence exists. Studio can open linked source and export saved definitions as OpenAPI 3.1 JSON to a new file selected with the native save dialog. Request and response text is descriptive. OpenAPI import, arbitrary controller generation, and executable OpenAPI directives are outside the phase.

From an API design or generated route, open a matching request in **API Playground**. Start the backend for this worktree first. The request targets its IPv4 loopback port only. Supply one query or header name/value pair per line as `name=value` and, for supported methods, a JSON body. Review the method, destination, worktree and payload sizes before sending. The view shows response status, duration, redacted headers and bounded text. It keeps recent method/status/duration in memory. It does not follow redirects or store tokens or body history.

## Page design and traceability

**Page Designer** saves a summary or tabular page definition. Phase 10 can publish one additional `/studio-page.html` entry in an unauthenticated Node.js project using Business Workspace. A table uses selected columns from a verified public CRUD GET route. A summary can use a supported GET or project-specific descriptive text. The page shares the template's branding. The review lists the exact Vite entry change, HTML and React source, generated page guide, and ownership update. Go, authentication-enabled projects, already published page edits, an occupied output or a customized Vite configuration block publication. Published pages remain regular source files editable outside Studio. The phase has no visual component canvas, custom form generator, or automatic navigation rewrites. After installing this public page, Studio blocks automatic authentication-module installation until the developer reviews the public entry outside Studio.

**Requirements** stores project-owned criteria, workflows and links to schema tables, API designs, pages, requirements and workspace source. Workflow steps are documentation. Artifact inspection compares observed source or design fingerprints and marks missing or changed references. Follow available links to their corresponding workspace tools. Studio preserves `docs/REQUIREMENTS.md` and custom instructions.

Saved definitions use the versioned `.factory/developer-design.json` file. Studio previews exact changes, verifies worktree state, opens a native approval dialog and publishes through the incremental journal. If interrupted, open **Generation Review** and select **Resume** or **Hand Off** after inspecting the pending operation. The transaction affects project files. It never applies migrations or writes PostgreSQL.
