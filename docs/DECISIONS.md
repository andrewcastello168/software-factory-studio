# Architecture decisions

## 0001 · Electron with separate privilege and compilation boundaries

**Status** Accepted in Phase 00.

Electron supplies a consistent desktop runtime for Windows-first development. React and Vite keep the renderer testable in a browser. Use a sandbox-compatible preload, per-capability IPC and a secure bundled origin. Separate main, preload, renderer and platform-neutral shared contracts. This adds Electron footprint and a browser/runtime patch cadence. It keeps privileged operations reviewable and allows browser UI coverage alongside native evidence.

## 0002 · Start with two workspace packages and minimal app-local persistence

**Status** Accepted in Phase 00.

Begin with the desktop app and shared contracts in strict TypeScript, with native Electron user-data paths and versioned JSON preferences. Defer SQLite and other native modules until a feature or measured need justifies them. JSON limits cross-record querying and high-volume writes. The smaller dependency graph avoids early native ABI and packaging concerns. Keep the persistence interface local and evolve it with actual consumers.

## 0003 · Directory grants and independent portable identities

**Status** Accepted in Phase 00.

The filesystem path identifies the active worktree, and an opaque window grant authorizes access. A portable UUID under `.factory/` identifies a managed project across moves and shared worktrees. Recents store references. Opening existing projects reads without creating metadata. This requires separate canonical-path, project, and Git common-directory identities. It makes worktree isolation, unmanaged inspection, and move handling explicit.

## 0004 · Deterministic plans and journaled, reviewed writes

**Status** Accepted in Phase 00.

Separate pure generation from privileged apply. Bind review to planned bytes, ownership, workspace identity, ref and commit, and relevant fingerprints. Journal recoverable writes and use verified, OS-appropriate primitives. Mark uncertain state recovery-required. This introduces storage and interruption tests. It protects edited source files and gives the future CLI the same planning contract. File safety under concurrent external changes remains an implementation gate.

## 0005 · Migration files define the declared PostgreSQL schema

**Status** Accepted for both planned PostgreSQL slices.

Use ordered, versioned migration SQL as source authority. Pending migrations depend on the target ledger. Physical state comes from opt-in catalog introspection. Keep layout and modeling metadata portable. Limited SQL support means some projects will be read-only or partially represented. This preserves developer-authored migrations and keeps Git operations independent of database execution.

## 0006 · Native Git with narrow policy and staged enablement

**Status** Accepted in Phase 00.

Use native Git with reviewed operation policies, fixed argv, temporary fixtures, and explicit approval for mutations. Start with confirmed clean checkout and fast-forward-only pull. Add dirty-tree handling and advanced directional branch operations after core safety verification. Untrusted Git configuration reduces the initially supported repository and remote cases. Supported operations retain native semantics and preserve interoperability.

## 0007 · Built-in executable stack adapters and declarative libraries

**Status** Accepted in Phase 00.

Ship reviewed executable adapters. Treat imported templates and modules as limited data and validate compatibility through actual Node and Go implementations before stabilizing the SDK. Defer execution of third-party plugin code until there is an isolation and capability design. This limits early extensions and avoids granting arbitrary machine access as part of ordinary library import.

## 0008 · Native frame and evidence-based Windows support

**Status** Accepted in Phase 00.

Keep the native window frame for Phase 01. Build the original workbench within it and verify appearance, input, and settings on Windows separately from Linux renderer and Electron checks. Defer Electron Builder and installer signing verification to Phase 12. Native frames offer less chrome customization. They retain platform behaviors while the project establishes its application layout and accessible interactions.

## 0009 · Append-only schema authoring before incremental application edits

**Status** Accepted in the Phase 00 final review.

Phase 05 can add a reviewed migration to an existing project through the journaled create path introduced in Phase 04. This extends file creation and leaves historical migrations and existing application files intact. Phase 06 adds ownership-aware application edits and derives missing components from a saved migration without duplicating it. The split limits the Phase 05 write surface while delivering a complete source schema authoring path.

## 0010 · Pin the Windows host toolchain and separate two development origins

**Status** Implemented in Phase 01.

Pin Node.js 22.16.0 and pnpm 10.13.1 for the workspace. Use the same versions in Cloud alongside its preinstalled toolchain. Electron 45.5.0 embeds Node.js 24.22.3 and Chromium 156.0.8078.109. The compiler targets JavaScript supported by the pinned host and Electron entry points. A direct esbuild bundle creates the independent main and sandboxed preload CommonJS entry points. React, Vite, and Tailwind build the renderer. The lockfile keeps platform-specific binary resolution reproducible. esbuild's optional platform package supplies the binary without running its install script. Electron binary setup is a separate explicit command.

Desktop development enables the exact Vite loopback URL only from the Electron development launcher. Browser development has its own port and session-only preview preferences. Both receive CSP headers and Vite HMR. Production loads local assets through `studio://app/`. The renderer has no external link-opening capability in this phase. Adding one later requires an explicit URL policy and a reviewed capability. Electron Builder remains scheduled for Phase 12.

## 0011 · Keep Phase 01 preferences narrow and versioned

**Status** Implemented in Phase 01.

Store a small settings file at a fixed Electron user-data path. Serialize reads and changes, then sync and replace via a fresh same-directory file. IPC exposes application metadata, validated theme and sidebar preference changes, and native theme events. Unknown future versions remain intact. A corrupted known record uses safe defaults and an explicit repair confirmation. I/O failure preserves the last supported state and provides a reload path. This keeps local settings usable while avoiding a database or broader user-data bridge.

## 0012 · Admit read-only project roots through Electron

**Status** Implemented in Phase 02.

The native chooser confirms the directory. Each window receives opaque project tokens for canonical roots and read-only actions. The renderer sends tokens to refresh or close a workspace. Main stores recent references in a separate versioned JSON file under the application profile. A different directory at a saved path needs fresh admission. Moving a managed project's portable UUID can establish identity at a new location without collapsing two accessible worktrees that share the same descriptor. Successful relocation revokes the previous token.

Project Structure is a bounded snapshot of names and metadata. The scanner examines at most 1,600 entries across ten levels and skips dependency and Git internals. A scan only reads file bytes from the fixed, size-bounded portable descriptor. Linux enumerates through a verified directory handle using procfs. Windows and macOS recheck canonical paths and directory identity around their path-based directory listing. Detected replacements invalidate the affected results. The Windows check uses the exact file ID and confirmed creation time when the path stat omits a volume serial. Links and junctions are leaves throughout the scan.

Linux and macOS use nonrecursive watchers for a bounded set of inspected directories. Windows uses one recursive native watch per project root to avoid keeping descendant handles open during moves. Events are invalidations, and names from events only filter dependency and Git internals. Bursts coalesce before rescanning. Focus, manual refresh, and a periodic reconciliation cover missed events and watcher limits. Recent-store containment uses the nearest canonical existing ancestor so Windows short-path aliases cannot bypass the read-only overlap check.

## Phase 03 decisions

| Decision | Rationale and trade-off |
| --- | --- |
| Use Phase 07 as the primary factory MVP | The complete loop is independent application generation, database-driven evolution, reusable engineering assets, and reviewed AI context. Phase numbers and approved later capabilities stay stable. External editing and integrations take precedence over IDE duplication. |
| Plan local project instructions in Phase 04 and reusable context in Phase 07 | Human-readable repository instructions work with ordinary editors and multiple coding assistants. Versioned context makes reuse reviewable. No AI provider, subscription, or prompt execution is necessary. |
| Keep Git orchestration inside Electron main with existing workspace grants | The normal project explorer stays read-only. Native confirmation, a reviewed repository revision, and named commands give the renderer narrow access. Polling refreshes the current tab without adding long-lived Git handles that could obstruct moves on Windows. |
| Scope the Git execution policy to standalone roots, public HTTPS, and separately admitted bare local remotes | Git configuration and attributes can delegate to external processes. A restricted config surface, inert hook path, and explicit argv preserve the product boundary at the cost of rejecting customized repositories, linked worktrees, private authentication, and custom transports until reviewed designs exist. |
| Separate fetch from a verified fast-forward, and push a reviewed object to an explicit upstream | Remote-tracking fetch results can survive a refused local checkout. This yields an accurate partial outcome and leaves divergent or ignored work intact. No physical database action follows branch changes. |

## Phase 04 decisions

| Decision | Rationale and trade-off |
| --- | --- |
| Ship one Full-stack starter with Layered Web and Standard Engineering v1 | A single verified option exercises server, browser, documentation and PostgreSQL without a template library. Profile versions are portable and new Studio versions leave generated projects alone. |
| Track the standalone lock and use Node's TypeScript development mode | Node 22.16.0 and pnpm 10.13.1 align with Studio. TypeScript 6 rewrites relative extensions for the production server build. The project needs no Studio runtime. |
| Publish new files exclusively and record recovery in app data | Same-directory staged hard links avoid overwriting existing content. The wizard supports absent destinations on filesystems with hard links. Recovery is resume or manual handoff, and avoids deletions of user files. |
| Verify file bytes in Studio and run code separately | A successful generation does not execute scripts or connect to a database. Platform workflow fixtures install, run, build and verify the generated app with their own disposable PostgreSQL databases. |

## Phase 04 modular composition follow-up

| Decision | Rationale and trade-off |
| --- | --- |
| Generate a foundation without domain features by default | PostgreSQL readiness and migration tooling remain real and reusable. The opt-in Welcome example shows how a module contributes a route, component, migration, test, and documentation without defining the client's requirements. |
| Plan from trusted, versioned contributions | Exact module pins, a compatibility catalog, and provenance keep the preview reproducible. Existing dependencies are reused. Installing modules after generation, authoring custom modules, and resolving full dependency graphs remain Phase 06–07 work. |
| Retain the released v1 renderer for recovery | Preserve approval hashes for interrupted jobs and avoid rewriting deployed projects. The wizard uses the modular v2 contract for new plans. |


## Phase 05 decisions

### Share safe primitives for project creation and schema publication

**Status** · Accepted for Phase 05.

Treat durable SQL files as schema authority and keep ERD coordinates in local app data. File generation remains deterministic. Database Studio writes only new additive migrations through the existing exclusive publisher, names an active migration journal, and requires native approval. CRUD is composed at scaffold time because the full new directory can be reviewed and replayed. Adding CRUD to an existing app and updating generated code remain ownership-aware Phase 06 operations. This delivers independently runnable CRUD and avoids undeclared file replacements.

### Use a bounded PostgreSQL grammar and separate development apply

**Status** · Accepted for Phase 05.

A closed DDL grammar handles a focused model and reports unsupported syntax; Studio does not execute SQL to discover its structure. Main uses the already-established pure JavaScript pg dependency for catalog queries and eligible development migrations. The catalog snapshot, source history, and ledger are separate views. Apply requires a dedicated loopback target, a native confirmation and a matching ledger and schema under lock. The stricter apply surface leaves unsupported and destructive operations with a separately reviewed database workflow.


## Phase 06 decisions

Use exact prior template bytes plus manifest ownership for the first incremental adapter. This supports deterministic updates to modular starter integrations and contracts while guarding customized entrypoints. Projects with changed integration code need a separate design for scoped transformations. The planner preserves client instructions and unrelated feature edits. Lock the ordered source history for each incremental application instead of generating duplicate migrations.

Use same-directory backups with an app-data journal for verified replacements. The platform does not expose a portable atomic compare-and-swap operation for an existing pathname. Moving the original aside and publishing exclusively preserves competing bytes and supports resume or manual handoff at the cost of a recoverable intermediate state. Keep receipt history separate from Git and PostgreSQL.


## Phase 07 decisions

- Store profile and template definitions as declarative snapshots. Profile instructions are advisory. The trusted Node adapter controls executable behavior. Export reviewed definitions as portable JSON. Project locks embed values and selected revisions so later library updates leave client projects independent.
- Use scrypt from Node, opaque database-backed sessions, exact same-origin checks and a host-prefixed secure cookie in HTTPS mode. Provision the first administrator explicitly from stdin. Separate administration writes from delegated read access. Authorize role assignment only through the bootstrap administrator. A trusted loopback TLS proxy is the production boundary for forwarded headers.
- Compose optional identity modules from bundled, versioned artifacts. Reuse Phase 06 recovery for reviewed source updates and appended SQL. Existing applied migrations remain immutable. Enable project-specific color, themes and approved text marks through the Business Workspace template. General-purpose visual editing and executable imports remain later capabilities.

## Phase 08 decisions

- Keep the reviewed adapter interface inside the generator package and the manifest registry in contracts. This gives the renderer safe capability discovery and preserves pre-Phase 08 Node plan bytes, without a separate runtime loader.
- Use Go 1.26.11, Gin 1.12.0 and pgx 5.13.0. Pin backend modules with go.mod/go.sum and the existing React toolchain with a separate frontend lock that has no Express or pg runtime dependency. Serve compiled assets from Go. The project environment supplies configuration without a dotenv dependency.
- Share PostgreSQL source interpretation, migrations, React record components, and the existing ownership-aware incremental planner. A Go project adds compiled record descriptors and a small HTTP route slot. Exact trusted integration bytes take precedence over editing customized route entry points. Node executable modules remain specific to Node; advisory profiles and declarative branding are reusable across both stacks.

## Phase 09 decisions

- Support conventional absolute reciprocal worktree registrations. Keep checkout and repository identities separate. Use a conservative shared Studio writer lock and existing workspace admission rather than inventing Git lockfiles.
- Compose read-only previews and require explicit plans for stashes, local integration, guarded branch and file changes, and conflict staging. Use native conflict handling and editor-based resolution. Bound rebase to a linear, locally unpublished range and cherry-pick to one non-merge commit.
- Store reviewed recovery receipts in user data and revalidate native markers and an allowlisted rebase sequence. Keep external Git operations, generator recovery and PostgreSQL recovery separate.

## Phase 10 · Local developer workspace

### Reviewed subprocesses and local requests

Use the pinned adapter's development commands and direct argv with session-scoped native approval. Runtime variables come from a bounded local configuration. This preserves native tools and user-owned source while excluding generic execution adapters and remote URL input. Runtime execution is a trust decision at operating system account scope. An HTTP request is allowed only on the worktree's active numerical loopback backend with an explicitly approved method and path. History retains only status metadata. VS Code and native terminals remain external applications.

### Data-only design and one owned page entry

Store API, page, requirements and workflow designs in a versioned worktree document. Derive implementation signals from the pinned generation manifest and actual source files. Scope the first reviewed React extension to an unauthenticated Node Business Workspace with a second Vite entry and reusable branded layout. This keeps its integration independent of existing React routing and avoids replacing custom pages or controller code. Later extensions can introduce versioned authenticated routes and reviewed component composition.

## Phase 11 · Client delivery and version sharing

Use the existing incremental review and append only known deployment and CI files. Existing custom files block template publication. Pin container bases by manifest digest and keep migration execution separate from startup.

Run Quality Center jobs through the developer command policy. Keep worktree-scoped evidence local and bind it to Git, source and configuration bytes. Publish a portable USTAR artifact from a clean revision with current passing checks and matching build outputs. Node packages use the locked production dependency install and Go packages carry native binaries. Explicit provider publication and desktop packaging remain separate tasks.

Share canonical content-addressed asset bundles using Git with exact asset and compatibility digests. Built-in module and stack metadata remain references to code shipped by Studio. This preserves a local workflow without expanding the importer into an executable plugin system.

## Windows RC distribution

Use Electron Builder 26.18.0 with the existing Electron 45.5.0, Node.js 22.16.0 and pnpm 10.13.1. Its Node engine supports the pinned host. Build only the Windows x64 NSIS target and leave the unrelated Squirrel postinstall script disabled. Stage the bundles and reviewed guides in an allowlisted, dependency-free app directory before archiving. Workspace packages, generator templates and their pinned locks are compiled into the production bundles. The Electron archive contains no package-manager installation, test fixtures or source checkout. Packaging, edition, and release upload are separate from automatic updating.

Keep the id `com.softwarefactorystudio.desktop` and the product name `Software Factory Studio` stable across releases. The current-user installation has its own program directory and Start Menu shortcut. The Electron product-name-based profile remains in roaming application data. NSIS preserves it on uninstall, which also preserves sensitive local data until the user handles it separately. Refuse to admit the installation tree as a project or publishing destination.

Use an unsigned CI build for internal acceptance without exposing certificate material to pull requests. Require Authenticode signing only when using the explicit signing command on a trusted host. Build an `rc.0` compatibility fixture from the same source as `rc.1` to exercise installer identity, data preservation and executable replacement. It is a test artifact. It does not prove upgrading a previously released version.

Pin the two packaging-time minimatch resolutions to the advisory fix at 11.0.1. Electron Builder uses the retained CommonJS matcher interfaces and the installer tests verify the active Windows packaging path. Remove the scoped overrides when the pinned builder graph ships the fix.
